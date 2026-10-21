import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';
import { request } from 'node:http';
import { fixture, hero, apply } from './helpers.mjs';
import { startPanel } from '../dist/panel.js';
import { partyState } from '../dist/domain.js';
import { schematic } from '../dist/maps.js';

async function files(root) {
  const out = {};
  for (const e of await readdir(root, { withFileTypes: true })) {
    const p = join(root, e.name);
    if (e.isDirectory()) out[e.name] = await files(p);
    else out[e.name] = (await readFile(p)).toString('base64');
  }
  return out;
}
async function panel(t, store, lan = false) {
  const p = await startPanel(store.root, { port: 0, lan });
  t.after(() => p.close());
  p.get = (path, options = {}) =>
    fetch(`http://127.0.0.1:${p.port}${path}`, {
      ...options,
      headers: { Authorization: `Bearer ${p.token}`, ...options.headers },
    });
  return p;
}

test('panel authenticates every data/image route and exposes no writes, files or DM option', async (t) => {
  const { store } = await fixture(t);
  const p = await panel(t, store, true);
  assert.equal(p.server.address().address, '0.0.0.0');
  if (p.urls.length > 1)
    assert.equal(
      (
        await fetch(new URL('/api/state', p.urls[1]), {
          headers: { Authorization: `Bearer ${p.token}` },
        })
      ).status,
      200,
    );
  assert.equal((await p.get('/api/state', { headers: { Authorization: '' } })).status, 401);
  assert.equal(
    (await p.get('/api/map?mapId=hidden&revision=0', { headers: { Authorization: 'bad' } })).status,
    401,
  );
  for (const path of ['/api/state?audience=dm', '/api/map?audience=dm'])
    assert.equal((await p.get(path)).status, 400);
  for (const path of [
    '/campaign.json',
    '/events/',
    '/assets/file.png',
    '/api/apply_campaign_changes',
    '/%2e%2e/campaign.json',
  ])
    assert.equal((await p.get(path)).status, 404);
  for (const method of ['POST', 'PUT', 'DELETE', 'OPTIONS'])
    assert.equal((await p.get('/api/state', { method })).status, 405);
  assert.equal(
    await new Promise((resolve) => {
      const req = request(
        { hostname: '127.0.0.1', port: p.port, path: '/api/state', headers: { Host: 'evil.test' } },
        (res) => {
          res.resume();
          resolve(res.statusCode);
        },
      );
      req.end();
    }),
    403,
  );
  assert.equal(
    (await p.get('/api/state', { headers: { Origin: 'https://evil.test' } })).status,
    403,
  );
  const response = await p.get('/');
  assert.match(response.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  assert.equal(response.headers.get('access-control-allow-origin'), null);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const state = await (await p.get('/api/state')).json();
  assert.deepEqual(state.party.members, []);
  assert.deepEqual(state.maps, []);
  const second = await panel(t, store);
  assert.notEqual(second.token, p.token);
  assert.equal(second.server.address().address, '127.0.0.1');
  assert.equal(
    (await second.get('/api/state', { headers: { Authorization: `Bearer ${p.token}` } })).status,
    401,
  );
});

test('dashboard and PNG use exact party state without writing campaign files or contacting journal', async (t) => {
  const { store, service, backend } = await fixture(t);
  await apply(service, [
    {
      type: 'put_entity',
      entity: {
        ...hero,
        name: '<script>bad()</script>',
        character: { ...hero.character, conditions: [{ name: 'prone' }] },
      },
    },
    { type: 'put_entity', entity: { ...hero, id: 'other', name: 'Other' } },
    { type: 'put_entity', entity: { ...hero, id: 'hidden', name: 'SECRET', visibility: 'dm' } },
    {
      type: 'put_entity',
      entity: {
        id: 'grid',
        name: 'Bridge',
        kind: 'map',
        map: {
          kind: 'grid',
          bounds: { width: 20, height: 20 },
          tokens: { hero: { x: 4, y: 6 }, other: { x: 5, y: 8 }, hidden: { x: 4, y: 7 } },
          revealedRegions: [{ x: 0, y: 0, width: 10, height: 10 }],
        },
      },
    },
    {
      type: 'put_entity',
      entity: {
        id: 'region',
        name: 'Region',
        kind: 'map',
        map: {
          kind: 'graph',
          nodes: ['town'],
          revealed: ['town'],
          tokens: { hero: { node: 'town' } },
        },
      },
    },
    {
      type: 'put_entity',
      entity: {
        id: 'private',
        name: 'SECRET',
        kind: 'map',
        visibility: 'dm',
        map: { kind: 'grid' },
      },
    },
    {
      type: 'put_entity',
      entity: {
        id: 'quest',
        name: 'Cross',
        kind: 'quest',
        quest: { objective: 'Cross the river', stakes: 'Time', status: 'active' },
      },
    },
    {
      type: 'put_entity',
      entity: {
        id: 'old',
        name: 'Old',
        kind: 'quest',
        quest: { objective: 'Old', stakes: '', status: 'resolved' },
      },
    },
    {
      type: 'set_encounter',
      encounter: {
        id: 'battle',
        participants: [
          { id: 'hidden', initiative: 20 },
          { id: 'hero', initiative: 10 },
        ],
      },
    },
  ]);
  for (let batch = 0; batch < 2; batch++)
    await apply(
      service,
      Array.from({ length: 60 }, (_, i) => ({
        type: 'put_entity',
        entity: {
          id: `item-${batch}-${i}`,
          kind: 'item',
          name: 'Item',
          item: { owner: 'hero', quantity: 1 },
        },
      })),
    );
  const before = await files(store.root);
  backend.fail = true;
  const calls = backend.calls.length;
  const p = await panel(t, store);
  const state = await (await p.get('/api/state')).json();
  assert.equal(state.sheets[0].inventory.length, 120);
  assert.equal(state.sheets[0].placements.length, 2);
  assert.deepEqual(
    state.quests.map((q) => q.id),
    ['quest'],
  );
  assert.equal(state.encounter.activeId, null);
  assert.doesNotMatch(JSON.stringify(state), /SECRET|"hidden"|"private"/);
  const original = (await store.read()).state;
  assert.equal(partyState(original).encounter.turn, -1);
  assert.doesNotMatch(schematic(partyState(original), 'grid', 'party').svg, /active turn/);
  const url = `/api/map?mapId=grid&revision=${state.revision}`;
  assert.equal((await p.get(url + '&x=9007199254740991&y=0&width=40&height=20')).status, 400);
  const image = await p.get(url);
  assert.equal(image.status, 200);
  const png = Buffer.from(await image.arrayBuffer());
  assert.equal((await sharp(png).metadata()).format, 'png');
  assert.deepEqual(
    png,
    await sharp(Buffer.from(schematic(original, 'grid', 'party').svg))
      .png()
      .toBuffer(),
  );
  assert.equal((await p.get(`/api/map?mapId=private&revision=${state.revision}`)).status, 404);
  assert.equal((await p.get(url + '&width=99&height=20&x=0&y=0')).status, 400);
  assert.deepEqual(await files(store.root), before);
  assert.equal(backend.calls.length, calls);
  await apply(service, [
    { type: 'damage', id: 'hero', amount: 7 },
    { type: 'set_positions', map: 'grid', positions: [{ entityId: 'hero', x: 6, y: 6 }] },
  ]);
  assert.equal((await p.get(url)).status, 409);
  const fresh = await (await p.get('/api/state')).json();
  assert.equal(fresh.sheets[0].character.character.hp, 7);
  assert.deepEqual(fresh.sheets[1].placements[0].position, { x: 5, y: 8 });
  const restarted = await panel(t, store);
  assert.deepEqual(await (await restarted.get('/api/state')).json(), fresh);
});

test('renderer failure and concurrent updates never publish a mislabeled PNG', async (t) => {
  const { store, service } = await fixture(t);
  await apply(service, [
    { type: 'put_entity', entity: hero },
    {
      type: 'put_entity',
      entity: {
        id: 'grid',
        name: 'Grid',
        kind: 'map',
        map: {
          kind: 'grid',
          bounds: { width: 20, height: 20 },
          revealedCells: [{ x: 1, y: 1 }],
          tokens: { hero: { x: 1, y: 1 } },
        },
      },
    },
  ]);
  const p = await panel(t, store);
  const before = await files(store.root);
  const original = sharp.prototype.toBuffer;
  const fail = t.mock.method(sharp.prototype, 'toBuffer', async () => {
    throw Error('private filesystem detail');
  });
  const failed = await p.get('/api/map?mapId=grid&revision=1');
  assert.equal(failed.status, 500);
  assert.doesNotMatch(await failed.text(), /private filesystem detail/);
  assert.deepEqual(await files(store.root), before);
  fail.mock.restore();
  let release, started;
  const gate = new Promise((resolve) => (release = resolve));
  const ready = new Promise((resolve) => (started = resolve));
  const delayed = t.mock.method(sharp.prototype, 'toBuffer', async function (...args) {
    started();
    await gate;
    return original.apply(this, args);
  });
  const pending = p.get('/api/map?mapId=grid&revision=1');
  await ready;
  await apply(service, [{ type: 'damage', id: 'hero', amount: 1 }]);
  release();
  assert.equal((await pending).status, 409);
  delayed.mock.restore();
  assert.equal((await p.get('/api/map?mapId=grid&revision=2')).status, 200);
  await apply(service, [{ type: 'set_party', members: [] }]);
  assert.deepEqual((await (await p.get('/api/state')).json()).sheets, []);
});
