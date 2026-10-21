import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, rm, symlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import sharp from 'sharp';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fixture, apply, FileJournal } from './helpers.mjs';
import { createMcpServer } from '../dist/server.js';
import { CampaignStore } from '../dist/store.js';
import { CampaignService } from '../dist/service.js';
import { JournalAdapter } from '../dist/journal.js';
import { renderMap, schematic } from '../dist/maps.js';
import { exportCampaign, importCampaign } from '../dist/backup.js';
import { partyState } from '../dist/domain.js';
const example = JSON.parse(await readFile('examples/lantern-ford.json', 'utf8'));
async function call(service, name, args) {
  const { revision } = await service.execute('campaign_status', {});
  return service.execute(name, {
    operationId: crypto.randomUUID(),
    expectedRevision: revision,
    reason: 'Map acceptance',
    ...args,
  });
}
async function opening(t) {
  const f = await fixture(t);
  await apply(f.service, example.changes);
  await call(f.service, 'create_location_map', { entity: example.bridgeMap });
  return f;
}

test('Briar Ford opening, ferryman conclusion, bridge split, fresh process and backup', async (t) => {
  const { service, store, parent } = await opening(t);
  let packet = await service.resume('dm');
  assert.match(packet.focus.primaryObjective, /lantern/);
  assert.ok(packet.scene.pendingDecision);
  assert.equal(packet.party.length, 2);
  await apply(service, example.concludeFerryman);
  await call(service, 'update_map_positions', {
    mapId: 'river-crossing',
    group: { entityIds: ['mara', 'tess'], position: { x: 4, y: 6 } },
  });
  await call(service, 'update_map_positions', {
    mapId: 'river-crossing',
    positions: [{ entityId: 'tess', x: 5, y: 8 }],
  });
  const dm = await service.execute('render_location_map', { mapId: 'river-crossing' });
  const party = await service.execute('render_location_map', {
    mapId: 'river-crossing',
    audience: 'party',
  });
  assert.deepEqual(dm.positions, { mara: { x: 4, y: 6 }, tess: { x: 5, y: 8 } });
  assert.equal((await sharp(Buffer.from(dm.image.data, 'base64')).metadata()).format, 'png');
  assert.notEqual(dm.image.data, party.image.data);
  const client = new Client({ name: 'fresh', version: '1' }),
    transport = new StdioClientTransport({
      command: process.execPath,
      args: [resolve('dist/server.js'), '--campaign', store.root],
      stderr: 'pipe',
    });
  transport.stderr?.on('data', () => {});
  await client.connect(transport);
  try {
    const result = await client.callTool({
      name: 'resume_campaign',
      arguments: { audience: 'dm' },
    });
    packet = result.structuredContent;
    assert.equal(packet.interactions.find((i) => i.id === 'oren').interaction.status, 'served');
    assert.deepEqual(
      packet.interactions.find((i) => i.id === 'oren').interaction.unresolvedTopics,
      [],
    );
    const image = await client.callTool({
      name: 'render_location_map',
      arguments: { mapId: 'river-crossing' },
    });
    assert.equal(image.content.find((c) => c.type === 'image').mimeType, 'image/png');
    assert.equal(image.content.find((c) => c.type === 'image').data, dm.image.data);
  } finally {
    await client.close();
    await transport.close();
  }
  await writeFile(join(store.root, 'assets', 'portrait.png'), Buffer.from(dm.image.data, 'base64'));
  await call(service, 'register_map_art', {
    mapId: 'river-crossing',
    art: {
      path: 'assets/portrait.png',
      purpose: 'Reference portrait',
      sourceRevision: dm.revision,
      visibility: 'dm',
    },
  });
  const archive = await exportCampaign(store);
  assert.equal(archive.assets.length, 1);
  const restored = await importCampaign(join(parent, 'restored'), archive);
  const fresh = new CampaignService(
    restored,
    new JournalAdapter(restored, new FileJournal(restored.root)),
  );
  const after = await fresh.execute('render_location_map', {
    mapId: 'river-crossing',
    revision: dm.revision,
  });
  assert.equal(after.image.data, dm.image.data);
  assert.deepEqual(
    (await restored.read()).state.entities['river-crossing'].map.tokens,
    dm.positions,
  );
  assert.equal((await restored.read()).state.entities.oren.interaction.status, 'served');
});

test('duplicate movement renders original revision; stale, invalid and failure requests preserve state', async (t) => {
  const { service, store } = await opening(t);
  const request = {
    operationId: 'move-once',
    expectedRevision: 2,
    reason: 'Bridge advance',
    mapId: 'river-crossing',
    positions: [{ entityId: 'mara', x: 4, y: 6 }],
  };
  const first = await service.execute('update_map_positions', request);
  await call(service, 'update_map_positions', {
    mapId: 'river-crossing',
    positions: [{ entityId: 'mara', x: 8, y: 6 }],
  });
  const duplicate = await service.execute('update_map_positions', request);
  assert.equal(duplicate.duplicate, true);
  assert.equal(duplicate.revision, first.revision);
  assert.equal(duplicate.currentRevision, 4);
  assert.equal(duplicate.image.data, first.image.data);
  await assert.rejects(
    service.execute('update_map_positions', { ...request, operationId: 'stale' }),
    /Reload/,
  );
  await assert.rejects(
    service.execute('update_map_positions', {
      ...request,
      positions: [{ entityId: 'mara', x: 9, y: 6 }],
    }),
    /different input/,
  );
  for (const positions of [
    [{ entityId: 'absent', x: 1, y: 1 }],
    [{ entityId: 'mara', x: 20, y: 0 }],
    [{ entityId: 'mara', x: 1.2, y: 2 }],
    [
      { entityId: 'mara', x: 1, y: 1 },
      { entityId: 'tess', x: -1, y: 0 },
    ],
  ])
    await assert.rejects(
      call(service, 'update_map_positions', { mapId: 'river-crossing', positions }),
    );
  assert.equal((await store.read()).state.revision, 4);
  service.renderer = async () => {
    throw Error('rasterizer unavailable');
  };
  const saved = await call(service, 'update_map_positions', {
    mapId: 'river-crossing',
    positions: [{ entityId: 'mara', x: 9, y: 6 }],
  });
  assert.equal(saved.status, 'positions saved; rendering failed');
  assert.equal((await store.read()).state.entities['river-crossing'].map.tokens.mara.x, 9);
  service.renderer = renderMap;
  const retry = await service.execute('render_location_map', {
    mapId: 'river-crossing',
    revision: saved.revision,
  });
  assert.equal(retry.positions.mara.x, 9);
  assert.equal((await store.read()).state.revision, 5);
});

test('same-level subgroup transfers preserve regional positions and other subgroup', async (t) => {
  const { service, store } = await opening(t);
  await call(service, 'create_location_map', {
    entity: {
      id: 'upstream',
      kind: 'map',
      name: 'Upstream',
      map: { kind: 'grid', bounds: { width: 20, height: 20 } },
    },
  });
  await call(service, 'update_map_positions', {
    mapId: 'upstream',
    group: { entityIds: ['tess'], position: { x: 1, y: 2 } },
  });
  const state = (await store.read()).state;
  assert.ok(state.entities['river-crossing'].map.tokens.mara);
  assert.equal(state.entities['river-crossing'].map.tokens.tess, undefined);
  assert.deepEqual(state.entities.upstream.map.tokens.tess, { x: 1, y: 2 });
  assert.equal(state.entities['ford-map'].map.tokens.mara.node, 'landing');
  assert.equal(state.scene.location, 'ford');
  await assert.rejects(
    call(service, 'update_map_positions', {
      mapId: 'upstream',
      group: { entityIds: ['oren'], position: { x: 1, y: 2 } },
    }),
    /roster/,
  );
});

test('player pixels and legend omit hidden markers, masked cells, features and graph labels', async (t) => {
  const { service, store } = await opening(t);
  await apply(service, [
    {
      type: 'put_entity',
      entity: { id: 'spy', kind: 'npc', name: 'SECRET SPY', visibility: 'dm' },
    },
    { type: 'set_positions', map: 'river-crossing', positions: [{ entityId: 'spy', x: 4, y: 4 }] },
  ]);
  const before = (await store.read()).state;
  const rendered = schematic(before, 'river-crossing', 'party');
  assert.doesNotMatch(rendered.svg, /SECRET|Keeper cache|spy/);
  const without = structuredClone(before);
  delete without.entities.spy;
  delete without.entities['river-crossing'].map.tokens.spy;
  without.entities['river-crossing'].map.features = without.entities[
    'river-crossing'
  ].map.features.filter((f) => f.id !== 'cache');
  assert.equal(rendered.svg, schematic(without, 'river-crossing', 'party').svg);
  const png = async (svg) => sharp(Buffer.from(svg)).png().toBuffer();
  assert.deepEqual(
    await png(rendered.svg),
    await png(schematic(without, 'river-crossing', 'party').svg),
  );
  await call(service, 'set_map_reveal', {
    mapId: 'river-crossing',
    revealed: false,
    cells: [{ x: 3, y: 6 }],
  });
  const hidden = await service.execute('render_location_map', {
    mapId: 'river-crossing',
    audience: 'party',
  });
  assert.equal(hidden.positions.mara, undefined);
  await call(service, 'set_map_reveal', {
    mapId: 'river-crossing',
    revealed: true,
    cells: [{ x: 3, y: 6 }],
  });
  assert.ok(
    (await service.execute('render_location_map', { mapId: 'river-crossing', audience: 'party' }))
      .positions.mara,
  );
  await call(service, 'create_location_map', {
    entity: {
      id: 'graph',
      kind: 'map',
      name: 'Graph',
      map: {
        kind: 'graph',
        nodes: ['one', 'two'],
        edges: [['one', 'two']],
        labels: { two: 'SECRET ROOM' },
        revealed: ['one'],
      },
    },
  });
  const graph = (await store.read()).state;
  assert.doesNotMatch(schematic(graph, 'graph', 'party').svg, /SECRET ROOM/);
  assert.deepEqual(partyState(graph).entities.graph.map.layout, {
    one: graph.entities.graph.map.layout.one,
  });
});

test('story progress persists, dormant quests stay retrievable and pressures require exact triggers', async (t) => {
  const { service, store } = await opening(t);
  await apply(service, [
    {
      type: 'set_quest',
      id: 'lantern-quest',
      quest: { objective: 'Done', stakes: 'None', status: 'resolved' },
    },
  ]);
  assert.equal(
    (await service.resume('dm')).entities.some((e) => e.id === 'lantern-quest'),
    false,
  );
  assert.equal(
    (await service.execute('get_campaign_entity', { id: 'lantern-quest' })).entity.quest.status,
    'resolved',
  );
  await assert.rejects(
    apply(service, [
      { type: 'trigger_pressure', id: 'flood', trigger: 'Three chat turns', evidence: 'Talked' },
    ]),
    /Trigger/,
  );
  await apply(service, [
    {
      type: 'trigger_pressure',
      id: 'flood',
      trigger: 'The party spends an hour at the crossing',
      evidence: 'Searched the bank for an hour',
    },
  ]);
  assert.equal((await store.read()).state.pressures.flood.occurrences, 1);
  assert.equal((await service.resume('party')).pressures.flood, undefined);
});

test('legacy unbounded grids infer viewport; new bounds are saved without changing earlier events', async (t) => {
  const { service, store } = await fixture(t);
  await apply(service, [
    {
      type: 'put_entity',
      entity: {
        id: 'oldhero',
        name: 'Legacy Hero',
        kind: 'character',
        character: { hp: 1, maxHp: 1 },
      },
    },
    {
      type: 'put_entity',
      entity: {
        id: 'oldmap',
        name: 'Legacy map',
        kind: 'map',
        map: { kind: 'grid', tokens: { oldhero: { x: 83, y: 90 } } },
      },
    },
  ]);
  const oldEvents = JSON.stringify(await store.events());
  const rendered = await service.execute('render_location_map', { mapId: 'oldmap' });
  assert.equal(rendered.viewport.x, 83);
  assert.equal(rendered.viewport.y, 90);
  assert.deepEqual(rendered.positions.oldhero, { x: 83, y: 90 });
  assert.equal(JSON.stringify(await store.events()), oldEvents);
  const entity = (await service.execute('get_campaign_entity', { id: 'oldmap' })).entity;
  await apply(service, [
    {
      type: 'set_map',
      id: 'oldmap',
      map: { ...entity.map, bounds: { width: 100, height: 100 }, origin: 'upper-left' },
    },
  ]);
  assert.equal(JSON.stringify((await store.events()).slice(0, 1)), oldEvents);
  const view = await service.execute('render_location_map', {
    mapId: 'oldmap',
    viewport: { x: 80, y: 80, width: 20, height: 20 },
  });
  assert.ok(view.positions.oldhero);
});

test('graph layout persists; explicit edge visibility hides connections between revealed rooms', async (t) => {
  const { service, store } = await opening(t);
  const created = await call(service, 'create_location_map', {
    entity: {
      id: 'rooms',
      kind: 'map',
      name: 'Rooms',
      map: {
        kind: 'graph',
        nodes: ['a', 'b'],
        edges: [['a', 'b']],
        revealed: ['a', 'b'],
        revealedEdges: [],
        locations: { a: 'ford', b: 'bridge' },
        tokens: { mara: { node: 'a' } },
      },
    },
  });
  const state = (await store.read()).state,
    layout = state.entities.rooms.map.layout;
  assert.ok(layout.a);
  assert.equal(partyState(state).entities.rooms.map.edges.length, 0);
  await call(service, 'set_map_reveal', { mapId: 'rooms', revealed: true, edges: [['a', 'b']] });
  assert.deepEqual(partyState((await store.read()).state).entities.rooms.map.edges, [['a', 'b']]);
  await call(service, 'set_map_reveal', { mapId: 'rooms', revealed: false, edges: [['a', 'b']] });
  const reopened = await CampaignStore.open(store.root);
  assert.deepEqual((await reopened.read()).state.entities.rooms.map.layout, layout);
  const replayed = await service.execute('render_location_map', {
    mapId: 'rooms',
    revision: created.revision,
  });
  assert.equal(created.image.data, replayed.image.data);
});

test('art and derived-map paths reject symlinks and invalid sources without losing committed movement', async (t) => {
  const { service, store, parent } = await opening(t);
  await writeFile(join(parent, 'outside.png'), 'not an image');
  await symlink(join(parent, 'outside.png'), join(store.root, 'assets', 'linked.png'));
  await assert.rejects(
    call(service, 'register_map_art', {
      mapId: 'river-crossing',
      art: { path: 'assets/linked.png', purpose: 'Test', sourceRevision: 2, visibility: 'dm' },
    }),
    /Symlinks/,
  );
  await writeFile(join(store.root, 'assets', 'text.png'), 'not an image');
  await assert.rejects(
    call(service, 'register_map_art', {
      mapId: 'river-crossing',
      art: { path: 'assets/text.png', purpose: 'Test', sourceRevision: 2, visibility: 'dm' },
    }),
    /supported image/,
  );
  await rm(join(store.root, '.dm', 'maps'), { recursive: true });
  await symlink(parent, join(store.root, '.dm', 'maps'));
  const result = await call(service, 'update_map_positions', {
    mapId: 'river-crossing',
    positions: [{ entityId: 'mara', x: 7, y: 6 }],
  });
  assert.equal(result.status, 'positions saved; rendering failed');
  assert.equal(result.positions.mara.x, 7);
  assert.equal((await store.read()).state.entities['river-crossing'].map.tokens.mara.x, 7);
});

test('large reveal regions stay compact when individual cells or overlapping rectangles are concealed', async (t) => {
  const { service, store } = await opening(t);
  await call(service, 'create_location_map', {
    entity: {
      id: 'large',
      kind: 'map',
      name: 'Large grid',
      map: {
        kind: 'grid',
        bounds: { width: 1000, height: 1000 },
        revealedRegions: [{ x: 0, y: 0, width: 1000, height: 1000 }],
        tokens: { mara: { x: 500, y: 500 }, tess: { x: 501, y: 500 } },
      },
    },
  });
  await call(service, 'set_map_reveal', {
    mapId: 'large',
    revealed: false,
    cells: [{ x: 500, y: 500 }],
  });
  let map = partyState((await store.read()).state).entities.large.map;
  assert.equal(map.tokens.mara, undefined);
  assert.ok(map.tokens.tess);
  assert.ok(map.revealedRegions.length <= 4);
  await call(service, 'set_map_reveal', {
    mapId: 'large',
    revealed: true,
    cells: [{ x: 500, y: 500 }],
  });
  assert.ok(partyState((await store.read()).state).entities.large.map.tokens.mara);
  await call(service, 'set_map_reveal', {
    mapId: 'large',
    revealed: false,
    regions: [{ x: 499, y: 499, width: 3, height: 3 }],
  });
  map = partyState((await store.read()).state).entities.large.map;
  assert.deepEqual(map.tokens, {});
  assert.ok(map.revealedRegions.length < 10);
});
