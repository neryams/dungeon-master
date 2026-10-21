import test from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { fixture, hero, apply, FileJournal } from './helpers.mjs';
import { CampaignStore } from '../dist/store.js';
import { CampaignService } from '../dist/service.js';
import { JournalAdapter } from '../dist/journal.js';
import { createMcpServer } from '../dist/server.js';

const item = (id, extra = {}) => ({
  type: 'put_entity',
  entity: { id, kind: 'item', name: id, item: { owner: 'hero', quantity: 1 }, ...extra },
});
const map = (id, data, extra = {}) => ({
  type: 'put_entity',
  entity: { id, kind: 'map', name: id, map: data, ...extra },
});

test('sheet reads one revision, returns inventory beyond resume cap and stays current after restart', async (t) => {
  const { service, store, backend } = await fixture(t);
  await apply(service, [
    { type: 'put_entity', entity: hero },
    ...Array.from({ length: 99 }, (_, i) => item(`item-${i}`)),
  ]);
  await apply(
    service,
    Array.from({ length: 15 }, (_, i) => item(`extra-${i}`)),
  );
  const before = JSON.stringify(await store.events());
  backend.fail = true;
  const read = store.read.bind(store);
  let reads = 0;
  store.read = async () => {
    reads++;
    return read();
  };
  const sheet = await service.execute('get_character_sheet', { characterId: 'hero' });
  assert.equal(reads, 1);
  assert.equal(sheet.revision, 2);
  assert.equal(sheet.inventory.length, 114);
  assert.equal(sheet.character.character.hp, 10);
  assert.equal(sheet.audience, 'party');
  assert.equal(backend.calls.length, 0);
  store.read = read;
  assert.equal(JSON.stringify(await store.events()), before);
  await apply(service, [
    { type: 'damage', id: 'hero', amount: 7 },
    { type: 'consume_item', id: 'item-0', quantity: 1 },
  ]);
  const reopened = await CampaignStore.open(store.root);
  const fresh = new CampaignService(
    reopened,
    new JournalAdapter(reopened, new FileJournal(reopened.root)),
  );
  const updated = await fresh.execute('get_character_sheet', { characterId: 'hero' });
  assert.equal(updated.revision, 3);
  assert.equal(updated.character.character.hp, 7);
  assert.equal(updated.character.character.tempHp, 0);
  assert.equal(updated.inventory.find((i) => i.id === 'item-0').item.quantity, 0);
  assert.equal(sheet.character.character.hp, 10);
});

test('sheets filter before joins and keep regional/tactical placements without scene fallback', async (t) => {
  const { service } = await fixture(t);
  await apply(service, [
    { type: 'put_entity', entity: hero },
    { type: 'put_entity', entity: { ...hero, id: 'other', name: 'Other' } },
    { type: 'put_entity', entity: { ...hero, id: 'secret', name: 'SECRET', visibility: 'dm' } },
    { type: 'put_entity', entity: { id: 'town', kind: 'location', name: 'Town' } },
    {
      type: 'put_entity',
      entity: { id: 'vault', kind: 'location', name: 'SECRET VAULT', visibility: 'dm' },
    },
    { type: 'set_party', members: ['hero', 'other', 'secret'] },
    item('visible'),
    item('secret-item', { visibility: 'dm' }),
    item('planned-item', { knowledge: 'plan' }),
    item('someone-elses', { item: { owner: 'other', quantity: 2 } }),
    map('region', {
      kind: 'graph',
      nodes: ['town-node'],
      edges: [],
      revealed: ['town-node'],
      locations: { 'town-node': 'town' },
      tokens: { hero: { node: 'town-node' } },
    }),
    map('tactical', {
      kind: 'grid',
      bounds: { width: 20, height: 20 },
      revealedCells: [{ x: 4, y: 6 }],
      tokens: { hero: { x: 4, y: 6 }, other: { x: 5, y: 6 } },
    }),
    map('private-map', { kind: 'grid', tokens: { hero: { x: 90, y: 90 } } }, { visibility: 'dm' }),
    map('secret-room', {
      kind: 'graph',
      nodes: ['hidden'],
      revealed: ['hidden'],
      locations: { hidden: 'vault' },
      labels: { hidden: 'SECRET LABEL' },
      tokens: { hero: { node: 'hidden' } },
    }),
    {
      type: 'set_scene',
      scene: { id: 'scene', title: 'Town scene', location: 'town', present: ['hero', 'other'] },
    },
  ]);
  const sheet = await service.execute('get_character_sheet', { characterId: 'hero' });
  assert.deepEqual(
    sheet.inventory.map((i) => i.id),
    ['visible'],
  );
  assert.equal(sheet.placements.length, 2);
  assert.deepEqual(sheet.placements.find((p) => p.level === 'regional').location, {
    id: 'town',
    name: 'Town',
  });
  assert.deepEqual(sheet.placements.find((p) => p.level === 'tactical').position, { x: 4, y: 6 });
  assert.doesNotMatch(JSON.stringify(sheet), /SECRET|private-map|secret-item|planned-item/);
  const overview = await service.execute('get_party_overview', {});
  assert.deepEqual(
    overview.members.map((m) => m.id),
    ['hero', 'other'],
  );
  assert.deepEqual(overview.members[1].placements, []);
  const dm = await service.execute('get_character_sheet', { characterId: 'hero', audience: 'dm' });
  assert.equal(dm.placements.length, 4);
  assert.equal(dm.inventory.length, 3);
  await assert.rejects(service.execute('get_character_sheet', { characterId: 'secret' }), {
    code: 'NOT_FOUND',
  });
  await assert.rejects(service.execute('get_character_sheet', { characterId: 'missing' }), {
    code: 'NOT_FOUND',
  });
  await assert.rejects(service.execute('get_character_sheet', { characterId: 'visible' }), {
    code: 'NOT_FOUND',
  });
});

test('party overview honors explicit subsets, empty roster and legacy character fallback', async (t) => {
  const { service } = await fixture(t);
  await apply(service, [
    { type: 'put_entity', entity: hero },
    { type: 'put_entity', entity: { ...hero, id: 'other' } },
  ]);
  let result = await service.execute('get_party_overview', {});
  assert.equal(result.rosterSource, 'legacy-characters');
  assert.equal(result.members.length, 2);
  await apply(service, [{ type: 'set_party', members: ['other'] }]);
  result = await service.execute('get_party_overview', {});
  assert.equal(result.rosterSource, 'explicit');
  assert.deepEqual(
    result.members.map((m) => m.id),
    ['other'],
  );
  await apply(service, [{ type: 'set_party', members: [] }]);
  assert.deepEqual((await service.execute('get_party_overview', {})).members, []);
});

test('MCP conversational sheet tools are read-only and return structured snapshots', async (t) => {
  const { service, store } = await fixture(t);
  await apply(service, [{ type: 'put_entity', entity: hero }]);
  const server = createMcpServer(service),
    client = new Client({ name: 'player-sheet', version: '1' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a);
  await client.connect(b);
  t.after(async () => {
    await client.close();
    await server.close();
  });
  const tools = (await client.listTools()).tools;
  for (const name of ['get_character_sheet', 'get_party_overview'])
    assert.equal(tools.find((t) => t.name === name).annotations.readOnlyHint, true);
  const overview = await client.callTool({ name: 'get_party_overview', arguments: {} });
  const response = await client.callTool({
    name: 'get_character_sheet',
    arguments: { characterId: overview.structuredContent.members[0].id },
  });
  assert.equal(response.structuredContent.character.character.hp, 10);
  assert.deepEqual(JSON.parse(response.content[0].text), response.structuredContent);
  assert.equal((await store.read()).state.revision, 1);
  const bad = await client.callTool({
    name: 'get_character_sheet',
    arguments: { characterId: '../secret' },
  });
  assert.equal(bad.isError, true);
});
