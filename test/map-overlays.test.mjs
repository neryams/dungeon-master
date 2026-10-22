import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { fixture, apply } from './helpers.mjs';
import { startPanel } from '../dist/panel.js';
import { renderMap, renderMapImage } from '../dist/maps.js';
import { exportCampaign, importCampaign } from '../dist/backup.js';
import { CampaignService } from '../dist/service.js';
import { JournalAdapter } from '../dist/journal.js';
import { FileJournal } from './helpers.mjs';
import { createMcpServer } from '../dist/server.js';

const CELL = 38;

async function putMap(service, map = {}) {
  await apply(service, [
    {
      type: 'put_entity',
      entity: {
        id: 'hero',
        kind: 'character',
        name: 'Hero',
        character: { hp: 10, maxHp: 10 },
      },
    },
    {
      type: 'put_entity',
      entity: {
        id: 'map',
        kind: 'map',
        name: 'Map title must not appear in reference mode',
        map: {
          kind: 'grid',
          bounds: { width: 4, height: 3 },
          tokens: { hero: { x: 1, y: 1 } },
          revealedRegions: [{ x: 0, y: 0, width: 4, height: 3 }],
          ...map,
        },
      },
    },
  ]);
}

async function register(
  service,
  root,
  { mapId = 'map', visibility = 'party', extent, image } = {},
) {
  await mkdir(join(root, 'assets'), { recursive: true });
  const asset = image ?? (await solid('#e020c0'));
  await writeFile(join(root, 'assets', 'overlay.png'), asset);
  const { revision } = await service.execute('campaign_status', {});
  return service.execute('register_map_art', {
    operationId: crypto.randomUUID(),
    expectedRevision: revision,
    reason: 'Register map overlay',
    mapId,
    art: {
      path: 'assets/overlay.png',
      purpose: 'Map background',
      sourceRevision: 1,
      visibility,
      ...(extent ? { background: { extent } } : {}),
    },
  });
}

async function solid(color) {
  return sharp({ create: { width: 4, height: 3, channels: 3, background: color } })
    .png()
    .toBuffer();
}

async function patterned() {
  const colors = [
    [224, 32, 192],
    [32, 192, 224],
    [192, 224, 32],
    [224, 128, 32],
    [160, 32, 224],
    [32, 224, 96],
    [224, 32, 64],
    [64, 96, 224],
    [32, 160, 160],
    [224, 192, 32],
    [128, 64, 32],
    [96, 224, 192],
  ];
  const raw = Buffer.alloc(4 * CELL * 3 * CELL * 3);
  for (let y = 0; y < 3 * CELL; y++) {
    for (let x = 0; x < 4 * CELL; x++) {
      const color = colors[Math.floor(y / CELL) * 4 + Math.floor(x / CELL)];
      const offset = (y * 4 * CELL + x) * 3;
      raw.set(color, offset);
    }
  }
  const png = await sharp(raw, { raw: { width: 4 * CELL, height: 3 * CELL, channels: 3 } })
    .png()
    .toBuffer();
  return { png, colors };
}

async function pixel(png, x, y) {
  const { data, info } = await sharp(png).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const offset = (y * info.width + x) * info.channels;
  return [...data.subarray(offset, offset + 3)];
}

async function containsColor(png, color) {
  const { data, info } = await sharp(png).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  for (let offset = 0; offset < data.length; offset += info.channels)
    if (color.every((channel, index) => data[offset + index] === channel)) return true;
  return false;
}

async function campaignFiles(root) {
  const result = {};
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) result[entry.name] = await campaignFiles(path);
    else result[entry.name] = (await readFile(path)).toString('base64');
  }
  return result;
}

test('reference mode is a clean cell-scaled PNG and ignores live marker positions', async (t) => {
  const { service, store } = await fixture(t);
  await putMap(service);
  const first = await service.execute('render_location_map', {
    mapId: 'map',
    audience: 'party',
    mode: 'reference',
  });
  assert.equal(first.mode, 'reference');
  assert.deepEqual(first.positions, {});
  assert.deepEqual(first.viewport, { x: 0, y: 0, width: 4, height: 3 });
  assert.deepEqual(
    await sharp(Buffer.from(first.image.data, 'base64'))
      .metadata()
      .then(({ width, height }) => ({ width, height })),
    { width: 4 * CELL, height: 3 * CELL },
  );
  await apply(service, [
    { type: 'set_positions', map: 'map', positions: [{ entityId: 'hero', x: 3, y: 2 }] },
  ]);
  const moved = await service.execute('render_location_map', {
    mapId: 'map',
    audience: 'party',
    mode: 'reference',
  });
  assert.deepEqual(moved.positions, {});
  assert.equal(moved.image.data, first.image.data);

  const defaultMap = await service.execute('render_location_map', {
    mapId: 'map',
    audience: 'party',
  });
  assert.equal(defaultMap.mode, 'map');
  assert.notEqual(defaultMap.image.data, moved.image.data);
  const legacy = await renderMap(store.root, (await store.read()).state, 'map', 'party');
  assert.deepEqual(
    Buffer.from(defaultMap.image.data, 'base64'),
    Buffer.from(legacy.image.data, 'base64'),
  );
});

test('background registration hashes the asset and geometry; overlay follows viewport and live state', async (t) => {
  const { service, store } = await fixture(t);
  await putMap(service);
  const { png: asset, colors } = await patterned();
  await register(service, store.root, {
    extent: { x: 0, y: 0, width: 4, height: 3 },
    image: asset,
  });
  const state = (await store.read()).state;
  const art = state.entities.map.map.art.at(-1);
  assert.equal(art.sha256, createHash('sha256').update(asset).digest('hex'));
  assert.match(art.background.geometryHash, /^[a-f0-9]{64}$/);

  const rendered = await service.execute('render_location_map', {
    mapId: 'map',
    audience: 'party',
  });
  const renderedPng = Buffer.from(rendered.image.data, 'base64');
  assert.deepEqual(await pixel(renderedPng, 54 + 10, 100 + 10), colors[0]);
  assert.notDeepEqual(await pixel(renderedPng, 54 + CELL + 19, 100 + CELL + 19), colors[5]);
  const reference = await service.execute('render_location_map', {
    mapId: 'map',
    audience: 'party',
    mode: 'reference',
  });
  assert.deepEqual(
    await pixel(Buffer.from(reference.image.data, 'base64'), 10, 10),
    [255, 255, 255],
  );

  const shifted = await service.execute('render_location_map', {
    mapId: 'map',
    audience: 'party',
    viewport: { x: 1, y: 0, width: 2, height: 2 },
  });
  assert.deepEqual(
    await pixel(Buffer.from(shifted.image.data, 'base64'), 54 + 10, 100 + 10),
    colors[1],
  );
  await apply(service, [
    { type: 'set_positions', map: 'map', positions: [{ entityId: 'hero', x: 2, y: 1 }] },
  ]);
  const afterMove = await service.execute('render_location_map', {
    mapId: 'map',
    audience: 'party',
  });
  assert.notEqual(afterMove.image.data, rendered.image.data);
  assert.equal((await store.read()).state.entities.map.map.art.at(-1).sha256, art.sha256);
});

test('graph art is hidden from party while any node or edge is hidden, and DM can see it', async (t) => {
  const { service, store } = await fixture(t);
  await apply(service, [
    {
      type: 'put_entity',
      entity: {
        id: 'graph',
        name: 'Rooms',
        kind: 'map',
        map: {
          kind: 'graph',
          nodes: ['a', 'b'],
          edges: [['a', 'b']],
          revealed: ['a'],
          revealedEdges: [],
        },
      },
    },
  ]);
  await mkdir(join(store.root, 'assets'), { recursive: true });
  await writeFile(join(store.root, 'assets', 'graph.png'), await solid('#e020c0'));
  const { revision } = await service.execute('campaign_status', {});
  await service.execute('register_map_art', {
    operationId: crypto.randomUUID(),
    expectedRevision: revision,
    reason: 'Graph background',
    mapId: 'graph',
    art: {
      path: 'assets/graph.png',
      purpose: 'Graph background',
      sourceRevision: 1,
      visibility: 'party',
      background: { extent: { x: 0, y: 0, width: 2, height: 2 } },
    },
  });
  const party = await service.execute('render_location_map', { mapId: 'graph', audience: 'party' });
  const dm = await service.execute('render_location_map', { mapId: 'graph', audience: 'dm' });
  assert.equal(
    party.warnings.some((warning) => /background|art/i.test(warning)),
    true,
  );
  assert.equal(await containsColor(Buffer.from(dm.image.data, 'base64'), [224, 32, 192]), true);
  await apply(service, [
    { type: 'set_reveal', map: 'graph', revealed: true, nodes: ['b'], edges: [['a', 'b']] },
  ]);
  const revealed = await service.execute('render_location_map', {
    mapId: 'graph',
    audience: 'party',
  });
  assert.equal(
    await containsColor(Buffer.from(revealed.image.data, 'base64'), [224, 32, 192]),
    true,
  );
});

test('grid masks stay opaque over art; missing or stale backgrounds fall back with a warning', async (t) => {
  const { service, store } = await fixture(t);
  await putMap(service, {
    revealedRegions: undefined,
    revealedCells: Array.from({ length: 12 }, (_, index) => ({
      x: index % 4,
      y: Math.floor(index / 4),
    })).filter(({ x, y }) => !(x === 2 && y === 1)),
  });
  await register(service, store.root, { extent: { x: 0, y: 0, width: 4, height: 3 } });
  const hidden = await service.execute('render_location_map', { mapId: 'map', audience: 'party' });
  const hiddenPoint = [54 + 2 * CELL + 19, 100 + CELL + 19];
  assert.deepEqual(
    await pixel(Buffer.from(hidden.image.data, 'base64'), ...hiddenPoint),
    [39, 48, 63],
  );

  await writeFile(join(store.root, 'assets', 'overlay.png'), 'changed and no longer a PNG');
  const stale = await service.execute('render_location_map', { mapId: 'map', audience: 'party' });
  assert.equal(
    stale.warnings.some((warning) => /background|art|asset/i.test(warning)),
    true,
  );
  assert.notDeepEqual(
    await pixel(Buffer.from(stale.image.data, 'base64'), 54 + 10, 100 + 10),
    [224, 32, 192],
  );
});

test('DM-only backgrounds stay out of party renders and geometry changes invalidate alignment', async (t) => {
  const { service, store } = await fixture(t);
  await putMap(service);
  await register(service, store.root, {
    visibility: 'dm',
    extent: { x: 0, y: 0, width: 4, height: 3 },
  });
  const party = await service.execute('render_location_map', { mapId: 'map', audience: 'party' });
  const dm = await service.execute('render_location_map', { mapId: 'map', audience: 'dm' });
  assert.equal(await containsColor(Buffer.from(party.image.data, 'base64'), [224, 32, 192]), false);
  assert.equal(await containsColor(Buffer.from(dm.image.data, 'base64'), [224, 32, 192]), true);

  const savedMap = (await store.read()).state.entities.map.map;
  await apply(service, [
    { type: 'set_map', id: 'map', map: { ...savedMap, bounds: { width: 5, height: 3 } } },
  ]);
  const outdated = await service.execute('render_location_map', { mapId: 'map', audience: 'dm' });
  assert.equal(
    outdated.warnings.some((warning) => /outdated|unverified|layout/i.test(warning)),
    true,
  );
  assert.equal(
    await containsColor(Buffer.from(outdated.image.data, 'base64'), [224, 32, 192]),
    false,
  );
});

test('concealed features suppress party art only over revealed geometry; DM graph art remains visible', async (t) => {
  const { service, store } = await fixture(t);
  await putMap(service, {
    features: [
      {
        id: 'secret-on-map',
        x: 1,
        y: 1,
        label: 'Hidden marker',
        kind: 'landmark',
        visibility: 'party',
        revealed: true,
      },
      {
        id: 'secret-in-fog',
        x: 3,
        y: 2,
        label: 'Fog marker',
        kind: 'landmark',
        visibility: 'party',
        revealed: true,
      },
    ],
  });
  const { png } = await patterned();
  await register(service, store.root, {
    extent: { x: 0, y: 0, width: 4, height: 3 },
    image: png,
  });
  const fingerprint = (await store.read()).state.entities.map.map.art.at(-1).background
    .geometryHash;

  await apply(service, [
    { type: 'set_reveal', map: 'map', revealed: false, features: ['secret-on-map'] },
  ]);
  let state = (await store.read()).state;
  assert.equal(state.entities.map.map.art.at(-1).background.geometryHash, fingerprint);
  assert.equal(
    state.entities.map.map.features.find((feature) => feature.id === 'secret-on-map').revealed,
    false,
  );
  let party = await service.execute('render_location_map', { mapId: 'map', audience: 'party' });
  assert.equal(
    party.warnings.some((warning) => /artwork/i.test(warning)),
    true,
  );
  assert.equal(await containsColor(Buffer.from(party.image.data, 'base64'), [224, 32, 192]), false);

  await apply(service, [
    { type: 'set_reveal', map: 'map', revealed: true, features: ['secret-on-map'] },
    { type: 'set_reveal', map: 'map', revealed: false, cells: [{ x: 3, y: 2 }] },
  ]);
  state = (await store.read()).state;
  assert.equal(state.entities.map.map.art.at(-1).background.geometryHash, fingerprint);
  party = await service.execute('render_location_map', { mapId: 'map', audience: 'party' });
  const partyPng = Buffer.from(party.image.data, 'base64');
  assert.equal(await containsColor(partyPng, [224, 32, 192]), true);
  assert.deepEqual(await pixel(partyPng, 54 + 3 * CELL + 19, 100 + 2 * CELL + 19), [39, 48, 63]);

  await apply(service, [
    {
      type: 'put_entity',
      entity: {
        id: 'graph',
        name: 'Graph',
        kind: 'map',
        map: {
          kind: 'graph',
          nodes: ['a', 'b'],
          edges: [['a', 'b']],
          revealed: ['a', 'b'],
          revealedEdges: [['a', 'b']],
          features: [
            {
              id: 'graph-secret',
              x: 1,
              y: 1,
              label: 'Hidden graph feature',
              kind: 'landmark',
              visibility: 'party',
              revealed: true,
            },
          ],
        },
      },
    },
  ]);
  await mkdir(join(store.root, 'assets'), { recursive: true });
  await writeFile(join(store.root, 'assets', 'graph-feature.png'), await solid('#e020c0'));
  const { revision } = await service.execute('campaign_status', {});
  await service.execute('register_map_art', {
    operationId: crypto.randomUUID(),
    expectedRevision: revision,
    reason: 'Graph feature background',
    mapId: 'graph',
    art: {
      path: 'assets/graph-feature.png',
      purpose: 'Graph feature background',
      sourceRevision: revision,
      visibility: 'party',
      background: { extent: { x: 0, y: 0, width: 2, height: 2 } },
    },
  });
  await apply(service, [
    { type: 'set_reveal', map: 'graph', revealed: false, features: ['graph-secret'] },
  ]);
  const partyGraph = await service.execute('render_location_map', {
    mapId: 'graph',
    audience: 'party',
  });
  const dmGraph = await service.execute('render_location_map', { mapId: 'graph', audience: 'dm' });
  assert.equal(
    partyGraph.warnings.some((warning) => /artwork/i.test(warning)),
    true,
  );
  assert.equal(
    await containsColor(Buffer.from(partyGraph.image.data, 'base64'), [224, 32, 192]),
    false,
  );
  assert.equal(
    await containsColor(Buffer.from(dmGraph.image.data, 'base64'), [224, 32, 192]),
    true,
  );
});

test('background overlay survives export/import and panel serves the same party composite without campaign writes', async (t) => {
  const { service, store, parent } = await fixture(t);
  await putMap(service);
  await register(service, store.root, { extent: { x: 0, y: 0, width: 4, height: 3 } });
  const before = await service.execute('render_location_map', { mapId: 'map', audience: 'party' });
  const archive = await exportCampaign(store);
  const restored = await importCampaign(join(parent, 'restored'), archive);
  const restoredService = new CampaignService(
    restored,
    new JournalAdapter(restored, new FileJournal(restored.root)),
  );
  const after = await restoredService.execute('render_location_map', {
    mapId: 'map',
    audience: 'party',
  });
  assert.equal(after.image.data, before.image.data);

  const p = await startPanel(store.root, { port: 0 });
  t.after(() => p.close());
  const filesBefore = await campaignFiles(store.root);
  const response = await fetch(
    `http://127.0.0.1:${p.port}/api/map?mapId=map&revision=${before.revision}`,
    {
      headers: { Authorization: `Bearer ${p.token}` },
    },
  );
  assert.equal(response.status, 200);
  assert.deepEqual(
    Buffer.from(await response.arrayBuffer()),
    Buffer.from(before.image.data, 'base64'),
  );
  assert.deepEqual(await campaignFiles(store.root), filesBefore);
});

test('panel reports and caches fallback warnings for concealed features', async (t) => {
  const { service, store } = await fixture(t);
  await putMap(service, {
    features: [
      {
        id: 'concealed-landmark',
        x: 1,
        y: 1,
        label: 'Hidden landmark',
        kind: 'landmark',
        visibility: 'party',
        revealed: true,
      },
    ],
  });
  await register(service, store.root, { extent: { x: 0, y: 0, width: 4, height: 3 } });
  await apply(service, [
    { type: 'set_reveal', map: 'map', revealed: false, features: ['concealed-landmark'] },
  ]);
  const { revision } = await service.execute('campaign_status', {});
  const p = await startPanel(store.root, { port: 0 });
  t.after(() => p.close());
  const url = `http://127.0.0.1:${p.port}/api/map?mapId=map&revision=${revision}`;
  const options = { headers: { Authorization: `Bearer ${p.token}` } };
  const first = await fetch(url, options);
  const warnings = JSON.parse(decodeURIComponent(first.headers.get('x-map-warnings')));
  assert.equal(
    warnings.some((warning) => /artwork/i.test(warning)),
    true,
  );
  const firstPng = Buffer.from(await first.arrayBuffer());
  const second = await fetch(url, options);
  assert.equal(second.headers.get('x-map-warnings'), first.headers.get('x-map-warnings'));
  assert.deepEqual(Buffer.from(await second.arrayBuffer()), firstPng);
});

test('renderMapImage exports without touching cache files and honors its explicit render mode', async (t) => {
  const { service, store } = await fixture(t);
  await putMap(service);
  const state = (await store.read()).state;
  const filesBefore = await campaignFiles(store.root);
  const output = await renderMapImage(
    store.root,
    state,
    'map',
    'party',
    { x: 1, y: 1, width: 2, height: 1 },
    'reference',
  );
  assert.ok(Buffer.isBuffer(output.png));
  assert.equal(output.mode, 'reference');
  assert.deepEqual(output.positions, {});
  assert.deepEqual(output.viewport, { x: 1, y: 1, width: 2, height: 1 });
  assert.deepEqual(
    await sharp(output.png)
      .metadata()
      .then(({ width, height }) => ({ width, height })),
    {
      width: 2 * CELL,
      height: CELL,
    },
  );
  assert.deepEqual(await campaignFiles(store.root), filesBefore);
});

test('MCP render tool returns the clean reference PNG as an image block', async (t) => {
  const { service } = await fixture(t);
  await putMap(service);
  const server = createMcpServer(service);
  const client = new Client({ name: 'reference-image-test', version: '1' });
  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  t.after(async () => {
    await client.close();
    await server.close();
  });

  const result = await client.callTool({
    name: 'render_location_map',
    arguments: { mapId: 'map', audience: 'party', mode: 'reference' },
  });
  const image = result.content.find((block) => block.type === 'image');
  assert.ok(image);
  assert.equal(image.mimeType, 'image/png');
  assert.deepEqual(
    await sharp(Buffer.from(image.data, 'base64'))
      .metadata()
      .then(({ width, height }) => ({ width, height })),
    { width: 4 * CELL, height: 3 * CELL },
  );
  assert.deepEqual(result.structuredContent.positions, {});
  assert.equal(result.structuredContent.mode, 'reference');
});
