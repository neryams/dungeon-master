import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import sharp from 'sharp';
import { fixture } from './helpers.mjs';
import { geometryFingerprint } from '../dist/map-art.js';
import { exportCampaign, importCampaign } from '../dist/backup.js';
import { apply } from './helpers.mjs';

async function register(service, store, args) {
  const { revision } = await service.execute('campaign_status', {});
  return service.execute('register_map_art', {
    operationId: randomUUID(),
    expectedRevision: revision,
    reason: 'Register illustrated map background',
    ...args,
  });
}

async function png(path) {
  await sharp({ create: { width: 40, height: 30, channels: 4, background: '#91aabb' } })
    .png()
    .toFile(path);
}

test('background registration stores byte hash and source geometry; movement and reveals do not stale it', async (t) => {
  const { service, store } = await fixture(t);
  const example = JSON.parse(await readFile('examples/lantern-ford.json', 'utf8'));
  await apply(service, example.changes);
  await service.execute('create_location_map', {
    operationId: randomUUID(),
    expectedRevision: (await store.read()).state.revision,
    reason: 'Create test map',
    entity: example.bridgeMap,
  });
  const sourceRevision = (await store.read()).state.revision;
  const sourceMap = (await store.read()).state.entities['river-crossing'].map;
  const sourceHash = geometryFingerprint(sourceMap);
  await service.execute('update_map_positions', {
    operationId: randomUUID(),
    expectedRevision: sourceRevision,
    reason: 'Move markers',
    mapId: 'river-crossing',
    positions: [{ entityId: 'mara', x: 7, y: 6 }],
    audience: 'dm',
  });
  const imagePath = join(store.root, 'assets', 'background.png');
  await png(imagePath);
  const bytes = await readFile(imagePath);
  const registered = await register(service, store, {
    mapId: 'river-crossing',
    art: {
      path: 'assets/background.png',
      purpose: 'Overhead illustration',
      sourceRevision,
      visibility: 'party',
      background: { extent: { x: 0, y: 0, width: 8, height: 7 } },
    },
  });
  const map = (await store.read()).state.entities['river-crossing'].map;
  const art = map.art.find((item) => item.path === 'assets/background.png');
  assert.equal(art.sha256, createHash('sha256').update(bytes).digest('hex'));
  assert.equal(art.background.geometryHash, sourceHash);
  assert.deepEqual(art.background.extent, { x: 0, y: 0, width: 8, height: 7 });
  assert.equal(registered.duplicate, false);
  await service.execute('set_map_reveal', {
    operationId: randomUUID(),
    expectedRevision: (await store.read()).state.revision,
    reason: 'Reveal area',
    mapId: 'river-crossing',
    revealed: true,
    cells: [{ x: 1, y: 1 }],
  });
  assert.equal(
    geometryFingerprint((await store.read()).state.entities['river-crossing'].map),
    sourceHash,
  );
});

test('new backgrounds reject invalid extents and stale geometry; exact retry survives removed image', async (t) => {
  const { service, store } = await fixture(t);
  const example = JSON.parse(await readFile('examples/lantern-ford.json', 'utf8'));
  await apply(service, example.changes);
  await service.execute('create_location_map', {
    operationId: randomUUID(),
    expectedRevision: (await store.read()).state.revision,
    reason: 'Create test map',
    entity: example.bridgeMap,
  });
  const sourceRevision = (await store.read()).state.revision;
  const imagePath = join(store.root, 'assets', 'background.png');
  await png(imagePath);
  await assert.rejects(
    register(service, store, {
      mapId: 'river-crossing',
      art: {
        path: 'assets/background.png',
        purpose: 'Bad extent',
        sourceRevision,
        visibility: 'dm',
        background: { extent: { x: 0, y: 0, width: 0, height: 7 } },
      },
    }),
    /width|positive/i,
  );
  const originalRequest = {
    mapId: 'river-crossing',
    art: {
      path: 'assets/background.png',
      purpose: 'Stale source',
      sourceRevision,
      visibility: 'dm',
      background: { extent: { x: 0, y: 0, width: 8, height: 7 } },
    },
  };
  const state = (await store.read()).state;
  const changed = structuredClone(state.entities['river-crossing']);
  changed.map.bounds.width--;
  await service.execute('apply_campaign_changes', {
    operationId: randomUUID(),
    expectedRevision: state.revision,
    reason: 'Change map geometry',
    changes: [{ type: 'put_entity', entity: changed }],
  });
  await assert.rejects(register(service, store, originalRequest), /geometry changed/i);

  const currentRevision = (await store.read()).state.revision;
  const fresh = {
    ...originalRequest,
    art: { ...originalRequest.art, sourceRevision: currentRevision, purpose: 'Valid background' },
  };
  const opId = randomUUID();
  const { revision } = await service.execute('campaign_status', {});
  const raw = { operationId: opId, expectedRevision: revision, reason: 'Exact retry', ...fresh };
  const committed = await service.execute('register_map_art', raw);
  await (await import('node:fs/promises')).rm(imagePath);
  const retried = await service.execute('register_map_art', raw);
  assert.equal(retried.duplicate, true);
  assert.equal(retried.revision, committed.revision);
});

test('geometry fingerprint excludes reveal and token state but includes static geometry', async () => {
  const a = {
    kind: 'grid',
    bounds: { width: 8, height: 7 },
    nodes: [],
    edges: [],
    tokens: {},
    revealedCells: [],
  };
  const b = structuredClone(a);
  b.tokens.hero = { x: 2, y: 3 };
  b.revealedCells.push({ x: 1, y: 1 });
  assert.equal(geometryFingerprint(a), geometryFingerprint(b));
  b.bounds.width++;
  assert.notEqual(geometryFingerprint(a), geometryFingerprint(b));
  const graph = { kind: 'graph', nodes: ['a', 'b'], edges: [], scale: '5 feet' };
  const reversed = { ...graph, nodes: ['b', 'a'] };
  assert.notEqual(geometryFingerprint(graph), geometryFingerprint(reversed));
  assert.notEqual(geometryFingerprint(graph), geometryFingerprint({ ...graph, scale: '10 feet' }));
});

test('background metadata survives export and import', async (t) => {
  const { service, store, parent } = await fixture(t);
  const example = JSON.parse(await readFile('examples/lantern-ford.json', 'utf8'));
  await apply(service, example.changes);
  await service.execute('create_location_map', {
    operationId: randomUUID(),
    expectedRevision: (await store.read()).state.revision,
    reason: 'Create test map',
    entity: example.bridgeMap,
  });
  const sourceRevision = (await store.read()).state.revision;
  const imagePath = join(store.root, 'assets', 'background.png');
  await png(imagePath);
  await register(service, store, {
    mapId: 'river-crossing',
    art: {
      path: 'assets/background.png',
      purpose: 'Export',
      sourceRevision,
      visibility: 'party',
      background: { extent: { x: 0, y: 0, width: 8, height: 7 } },
    },
  });
  const archive = await exportCampaign(store);
  const restored = await importCampaign(join(parent, 'restored'), archive);
  assert.deepEqual(
    (await restored.read()).state.entities['river-crossing'].map.art,
    (await store.read()).state.entities['river-crossing'].map.art,
  );
});
