import test from 'node:test';
import { request as httpRequest } from 'node:http';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fixture, apply, hero } from './helpers.mjs';
import { DesktopHost } from '../dist/desktop/host.js';
import { gameplayFingerprint } from '../dist/review.js';
import { partyState } from '../dist/domain.js';
import { exportCampaign, importCampaign } from '../dist/backup.js';

async function setup(t) {
  const f = await fixture(t);
  await apply(f.service, [
    { type: 'put_entity', entity: hero },
    { type: 'put_entity', entity: { ...hero, id: 'second', name: 'Second' } },
    {
      type: 'put_entity',
      entity: { ...hero, id: 'secret', name: 'PRIVATE_SECRET', visibility: 'dm' },
    },
  ]);
  let finish,
    runs = 0;
  const host = new DesktopHost({
    source: resolve('.'),
    permissionPath: join(f.parent, 'settings.json'),
    probe: async () => ({ path: process.execPath, version: 'fixture' }),
    driver: () => ({
      run: async () => {
        runs++;
        if (runs === 1) return { tools: ['call_mcp_tool'], campaignIds: ['test'] };
        return new Promise((resolve, reject) => {
          finish = { resolve, reject };
        });
      },
      close: async () => {
        finish?.reject(new Error('Stopped'));
      },
    }),
  });
  t.after(() => host.close());
  await host.open(f.store.root);
  await host.connect();
  const [firstLan, secondLan] = await Promise.all([host.startLan(), host.startLan()]);
  assert.deepEqual(firstLan.urls, secondLan.urls);
  const lan = firstLan,
    url = new URL(lan.urls[0]);
  const request = async (path, data, token, headers = {}) => {
    const r = await fetch(`${url.origin}/api/${path}`, {
      method: data === undefined ? 'GET' : 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token ?? ''}`,
        ...headers,
      },
      body: data === undefined ? undefined : JSON.stringify(data),
    });
    return { status: r.status, body: await r.json() };
  };
  const a = (await request('join', { name: 'Alice', invitation: url.hash.slice(1) })).body;
  const b = (await request('join', { name: 'Bob', invitation: url.hash.slice(1) })).body;
  await request('claim', { characterId: 'hero' }, a.token);
  await request('claim', { characterId: 'second' }, b.token);
  const state = async () => (await request('state', undefined, a.token)).body;
  const intent = async (token, text, extra = {}) =>
    request(
      'intent',
      {
        id: randomUUID(),
        epoch: (await state()).gathering.epoch,
        text,
        confirmed: true,
        pass: false,
        ...extra,
      },
      token,
    );
  const complete = async (responseRequest) => {
    for (let i = 0; i < 100 && !finish; i++) await delay(5);
    const s = await host.snapshot();
    await f.service.execute('publish_table_message', {
      operationId: randomUUID(),
      expectedRevision: s.revision,
      reason: 'test',
      requestId: s.table.at(-1).id,
      text: 'Public result',
      ...(responseRequest ? { responseRequest } : {}),
    });
    finish.resolve({ tools: [], campaignIds: [] });
    finish = undefined;
    for (let i = 0; i < 100 && (await host.snapshot()).stage === 'resolving'; i++) await delay(5);
  };
  return { ...f, host, lan, url, request, a, b, state, intent, complete, runs: () => runs };
}
test('LAN owns seats, batches once, handles Send now, targeted replies and safe reconnects', async (t) => {
  const f = await setup(t);
  const { request, a, b, state, intent, complete, host } = f;
  assert.equal((await request('state')).status, 401);
  assert.equal(
    (await request('state', undefined, a.token, { Origin: 'http://evil.test' })).status,
    403,
  );
  assert.equal((await request('claim', { characterId: 'hero' }, b.token)).status, 409);
  assert.equal((await request('claim', { characterId: 'secret' }, b.token)).status, 409);
  assert.doesNotMatch(
    JSON.stringify(await state()),
    /PRIVATE_SECRET|campaignRoot|ownerToken|permissionPath/,
  );
  assert.equal((await state()).root, undefined);
  const fp = gameplayFingerprint((await f.store.read()).state);
  assert.equal((await intent(a.token, 'Watch the door')).status, 200);
  assert.equal(f.runs(), 1);
  assert.equal((await intent(b.token, 'Examine the floor')).status, 200);
  for (let i = 0; i < 100 && f.runs() < 2; i++) await delay(5);
  assert.equal(f.runs(), 2);
  assert.equal((await state()).table.at(-1).actions.length, 2);
  const pending = await host.snapshot();
  await assert.rejects(
    f.service.execute('publish_table_message', {
      operationId: randomUUID(),
      expectedRevision: pending.revision,
      reason: 'Invalid prompt',
      requestId: pending.table.at(-1).id,
      text: 'Question',
      responseRequest: { characterIds: ['hero', 'hero'], prompt: 'Choose', kind: 'decision' },
    }),
    /Choose each character once/,
  );

  assert.equal((await intent(a.token, 'Overtake', { sendNow: true })).status, 409);
  await complete();
  const retry = {
    id: randomUUID(),
    epoch: (await state()).gathering.epoch,
    text: 'Keep watch',
    confirmed: true,
    pass: false,
  };
  assert.equal((await request('intent', retry, a.token)).status, 200);
  assert.equal((await intent(b.token, 'Speak now', { sendNow: true })).status, 200);
  await complete();
  assert.equal((await state()).gathering.actions.hero.confirmed, false);
  assert.equal((await request('intent', retry, a.token)).status, 200);
  assert.equal(
    (await state()).gathering.actions.hero.confirmed,
    false,
    'Retry must not reconfirm stale intention',
  );
  assert.equal((await intent(a.token, 'Ask DM', { sendNow: true })).status, 200);
  await complete({ characterIds: ['second'], prompt: 'Do you use a reaction?', kind: 'reaction' });
  assert.deepEqual((await state()).required, ['second']);
  assert.equal((await intent(a.token, 'Interrupt')).status, 409);
  assert.equal((await intent(b.token, 'Yes', { sendNow: true })).status, 409);
  assert.equal((await intent(b.token, 'No reaction')).status, 200);
  await complete();
  assert.equal(gameplayFingerprint((await f.store.read()).state), fp);
  assert.equal(partyState((await f.store.read()).state).gathering, undefined);
  const backup = await importCampaign(join(f.parent, 'restore'), await exportCampaign(f.store));
  assert.deepEqual((await backup.read()).state, (await f.store.read()).state);
  const before = (await state()).gathering.epoch;
  await apply(f.service, [{ type: 'heal', id: 'hero', amount: 1 }]);
  assert.equal(
    (await request('intent', { ...retry, id: randomUUID(), epoch: before }, a.token)).status,
    409,
  );
  const previous = f.url.hash.slice(1);
  await host.lanAdmin({ action: 'rotate' });
  assert.equal((await request('join', { name: 'Old', invitation: previous })).status, 401);
  await host.lanAdmin({ action: 'remove', clientId: b.clientId });
  assert.equal((await request('state', undefined, b.token)).status, 401);
  await host.stopLan();
  await assert.rejects(fetch(`${f.url.origin}/api/state`));
  const restart = await host.startLan();
  assert.notEqual(restart.urls[0], f.lan.urls[0]);
  assert.deepEqual((await host.snapshot()).gathering.seats, []);
});

test('LAN initiative, passes, host recovery and durable drafts', async (t) => {
  const f = await setup(t);
  const { intent, a, b, host, state, complete } = f;
  await apply(f.service, [
    {
      type: 'set_encounter',
      encounter: {
        id: 'fight',
        round: 1,
        turn: 0,
        participants: [
          { id: 'hero', initiative: 20 },
          { id: 'second', initiative: 10 },
        ],
      },
    },
  ]);
  assert.equal((await intent(b.token, 'Attack out of turn')).status, 409);
  assert.equal((await intent(b.token, 'Plan next turn', { confirmed: false })).status, 200);
  assert.equal((await intent(a.token, 'Attack')).status, 200);
  await complete();
  assert.equal((await state()).gathering.actions.second.confirmed, false);
  await host.lanAdmin({ action: 'skip', characterId: 'hero' });
  await complete({ characterIds: ['hero', 'second'], prompt: 'Choose a route', kind: 'decision' });
  assert.equal((await intent(a.token, 'Left')).status, 200);
  assert.equal((await state()).stage, 'ready');
  await host.lanAdmin({ action: 'resolve' });
  await complete();
  await apply(f.service, [{ type: 'put_entity', entity: { ...hero, id: 'third', name: 'Third' } }]);
  await intent(a.token, 'Ask an unclaimed character', { sendNow: true });
  await complete({ characterIds: ['third'], prompt: 'Third, join us?', kind: 'decision' });
  const seats = (await state()).gathering.seats;
  await host.lanAdmin({ action: 'skip', characterId: 'third' });
  await complete();
  assert.deepEqual(
    (await state()).gathering.seats,
    seats,
    'Passing an unclaimed target must not enroll it in later groups',
  );
  assert.equal((await intent(a.token, 'Uncertain', { sendNow: true })).status, 200);
  await delay(30);
  await host.stop();
  assert.equal((await state()).table.at(-1).status, 'interrupted');
  assert.equal((await state()).gathering.actions.second.text, 'Plan next turn');
});

test('LAN concurrent confirmations and retry while responding dispatch once', async (t) => {
  const f = await setup(t);
  const epoch = (await f.state()).gathering.epoch;
  const one = { id: randomUUID(), epoch, text: 'Watch', confirmed: true, pass: false };
  const two = { id: randomUUID(), epoch, text: 'Listen', confirmed: true, pass: false };
  const responses = await Promise.all([
    f.request('intent', one, f.a.token),
    f.request('intent', two, f.b.token),
  ]);
  assert.deepEqual(
    responses.map((r) => r.status),
    [200, 200],
  );
  for (let i = 0; i < 100 && f.runs() < 2; i++) await delay(5);
  assert.equal(f.runs(), 2);
  assert.equal((await f.request('intent', one, f.a.token)).status, 200);
  assert.equal((await f.request('intent', { ...one, text: 'Changed' }, f.a.token)).status, 409);
  assert.equal(f.runs(), 2);
  const invalidHost = await new Promise((resolve) => {
    const req = httpRequest(
      `${f.url.origin}/api/state`,
      { headers: { Host: 'evil.test', Authorization: `Bearer ${f.a.token}` } },
      (res) => {
        res.resume();
        resolve(res.statusCode);
      },
    );
    req.end();
  });
  assert.equal(invalidHost, 403);
  assert.equal(
    (await f.request('map', { mapId: 'secret', revision: (await f.state()).revision }, f.a.token))
      .status,
    409,
  );
  assert.equal((await f.request('open', { root: '/tmp' }, f.a.token)).status, 404);
  await f.complete();
  await f.host.lanAdmin({ action: 'release', clientId: f.b.clientId });
  await f.host.lanAdmin({ action: 'assign', clientId: f.b.clientId, characterId: 'second' });
  assert.equal((await f.request('state', undefined, f.b.token)).body.self.characterId, 'second');
});
