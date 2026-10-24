import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { join, resolve } from 'node:path';
import { fixture, apply, hero } from './helpers.mjs';
import { DesktopHost } from '../dist/desktop/host.js';
import { requestPlayerRoll } from '../dist/desktop/player-roll.js';

test('LAN roll submissions belong to the claimed seat and retain exact raw-face retries', async (t) => {
  const f = await fixture(t);
  await apply(f.service, [
    { type: 'put_entity', entity: hero },
    { type: 'put_entity', entity: { ...hero, id: 'second', name: 'Second' } },
    { type: 'set_party', members: ['hero', 'second'] },
  ]);
  const host = new DesktopHost({
    source: resolve('.'),
    permissionPath: join(f.parent, 'settings.json'),
    probe: async () => ({ path: process.execPath, version: 'fixture' }),
    driver: () => ({
      run: async () => ({ tools: ['call_mcp_tool'], campaignIds: ['test'] }),
      close: async () => {},
    }),
  });
  t.after(() => host.close());
  await host.open(f.store.root);
  await host.connect();
  const invitation = new URL((await host.startLan()).urls[0]);
  const request = async (path, input, token) => {
    const response = await fetch(`${invitation.origin}/api/${path}`, {
      method: input === undefined ? 'GET' : 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token ?? ''}` },
      body: input === undefined ? undefined : JSON.stringify(input),
    });
    return { status: response.status, body: await response.json() };
  };
  const joinSeat = async (name, characterId) => {
    const joined = await request('join', { name, invitation: invitation.hash.slice(1) });
    assert.equal(joined.status, 200);
    if (characterId)
      assert.equal((await request('claim', { characterId }, joined.body.token)).status, 200);
    return joined.body;
  };
  const alice = await joinSeat('Alice', 'hero');
  const bob = await joinSeat('Bob', 'second');
  const spectator = await joinSeat('Spectator');

  const revision = (await f.store.read()).state.revision;
  const pending = await requestPlayerRoll(f.store, {
    operationId: randomUUID(),
    expectedRevision: revision,
    reason: 'Perception check',
    actor: 'dm',
    characterId: 'hero',
    expression: '1d20+3',
    mode: 'normal',
    purpose: 'Perception check',
    visibility: 'party',
  });
  assert.ok(pending);
  const heroState = await request('state', undefined, alice.token);
  assert.deepEqual(
    heroState.body.pendingRolls.map((roll) => roll.id),
    [pending.id],
  );
  assert.deepEqual((await request('state', undefined, bob.token)).body.pendingRolls, []);

  const physical = { id: pending.id, dice: [17] };
  assert.equal((await request('roll', physical, spectator.token)).status, 409);
  assert.equal((await request('roll', physical, bob.token)).status, 409);
  await assert.rejects(host.submitRoll(physical), /LAN seat/);
  assert.ok((await f.store.read()).state.pendingRolls[pending.id]);

  const accepted = await request('roll', physical, alice.token);
  assert.equal(accepted.status, 200);
  assert.equal(accepted.body.duplicate, false);
  assert.deepEqual(accepted.body.roll.dice, [17]);
  assert.equal(accepted.body.roll.modifier, 3);
  assert.equal(accepted.body.roll.total, 20);
  assert.equal(accepted.body.roll.source, 'physical');
  assert.equal((await request('roll', physical, alice.token)).body.duplicate, true);
  assert.equal((await request('roll', { id: pending.id, dice: [18] }, alice.token)).status, 409);
  assert.equal((await request('roll', physical, bob.token)).status, 409);
  for (const seat of [alice, bob]) {
    const state = (await request('state', undefined, seat.token)).body;
    assert.deepEqual(state.pendingRolls, []);
    const saved = state.rollHistory.find((roll) => roll.id === accepted.body.roll.id);
    assert.deepEqual(saved.dice, [17]);
    assert.equal(saved.total, 20);
    assert.equal(saved.source, 'physical');
  }
  assert.equal(
    (await f.store.read()).events.filter((e) => e.payload.completesRoll === pending.id).length,
    1,
  );

  const second = await requestPlayerRoll(f.store, {
    operationId: randomUUID(),
    expectedRevision: (await f.store.read()).state.revision,
    reason: 'Second check',
    actor: 'dm',
    characterId: 'hero',
    expression: '1d6',
    mode: 'normal',
    purpose: 'Second check',
    visibility: 'party',
  });
  await host.lanAdmin({ action: 'release', clientId: alice.clientId });
  assert.equal((await request('roll', { id: second.id, dice: [4] }, alice.token)).status, 409);
  assert.ok((await f.store.read()).state.pendingRolls[second.id]);
});
