import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { connect } from 'node:net';
import { fixture, apply, hero } from './helpers.mjs';
import { DesktopActivity } from '../dist/desktop/activity.js';
import { ActivityBus, notifyActivity } from '../dist/desktop/activity-bus.js';

test('local activity bus rejects foreign tokens and closes its private endpoint', async () => {
  const token = randomUUID();
  const notices = [];
  const bus = await ActivityBus.listen(token, async (notice) => {
    await new Promise((resolve) => setTimeout(resolve, 20));
    notices.push(notice);
  });
  try {
    await notifyActivity(bus.endpoint, {
      token: randomUUID(),
      kind: 'activity',
      activity: { phase: 'Checking rules', rolls: [] },
    });
    assert.equal(notices.length, 0);
    await notifyActivity(bus.endpoint, {
      token,
      kind: 'activity',
      activity: { phase: 'Checking rules', rolls: [] },
    });
    assert.equal(notices.length, 1);
    assert.equal(notices[0].activity.phase, 'Checking rules');
    const bytes = Buffer.from(
      JSON.stringify({ token, kind: 'activity', activity: { phase: 'Rules 🐉', rolls: [] } }) +
        '\n',
    );
    const split = bytes.indexOf(Buffer.from('🐉')) + 2;
    await new Promise((resolve, reject) => {
      const socket = connect(bus.endpoint);
      socket.once('error', reject);
      socket.once('connect', () => {
        socket.write(bytes.subarray(0, split), () => socket.write(bytes.subarray(split)));
      });
      socket.once('data', () => {
        socket.destroy();
        resolve();
      });
    });
    assert.equal(notices.at(-1).activity.phase, 'Rules 🐉');
  } finally {
    await bus.close();
  }
  await notifyActivity(bus.endpoint, { token, kind: 'changed' });
  assert.equal(notices.length, 2);
});

async function activityFor(store, token) {
  const directory = join(store.root, '.dm/hotseat');
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, 'owner.json'), JSON.stringify({ pid: process.pid, token }));
  return new DesktopActivity(store, token);
}

test('desktop activity shows only committed party dice with generic labels and deduplicates retries', async (t) => {
  const { store, service } = await fixture(t);
  const token = randomUUID();
  const activity = await activityFor(store, token);
  await activity.reset();
  const input = {
    operationId: 'public-roll-retry',
    expectedRevision: 0,
    reason: 'roll',
    expression: '1d20+3',
    mode: 'normal',
    purpose: 'Perception check against hidden DC 17',
    visibility: 'party',
  };
  await activity.beginTool('roll_dice', input);
  assert.equal((await activity.snapshot(token)).rolls[0].status, 'rolling');
  await service.execute('roll_dice', input);
  await activity.finishTool(input.operationId);
  const completed = await activity.snapshot(token);
  assert.equal(completed.rolls.length, 1);
  assert.equal(completed.rolls[0].status, 'complete');
  assert.equal(completed.rolls[0].label, 'Dice roll');
  assert.equal(completed.rolls[0].notation, '1d20+3');
  assert.equal(completed.rolls[0].total, completed.rolls[0].dice[0] + 3);
  assert.doesNotMatch(JSON.stringify(completed), /hidden DC|Perception/);
  await activity.finishTool(input.operationId, new Error('lost acknowledgement'));
  assert.equal((await activity.snapshot(token)).rolls[0].status, 'complete');
  await service.execute('roll_dice', input);
  await activity.beginTool('roll_dice', input);
  await activity.finishTool(input.operationId);
  assert.equal((await activity.snapshot(token)).rolls.length, 1);
  await Promise.all([
    activity.beginTool('roll_dice', { ...input, operationId: 'concurrent-a' }),
    activity.beginTool('roll_dice', { ...input, operationId: 'concurrent-b' }),
  ]);
  const concurrent = await activity.snapshot(token);
  assert.deepEqual(
    concurrent.rolls.slice(-2).map((roll) => roll.id),
    ['concurrent-a', 'concurrent-b'],
  );
});

test('desktop activity omits DM rolls and only exposes committed public roll results', async (t) => {
  const { store, service } = await fixture(t);
  const token = randomUUID();
  const activity = await activityFor(store, token);
  await activity.reset();
  const dmRoll = {
    operationId: 'secret-roll',
    expectedRevision: 0,
    reason: 'secret',
    expression: '1d20',
    purpose: 'Secret perception',
    visibility: 'dm',
  };
  await activity.beginTool('roll_dice', dmRoll);
  await service.execute('roll_dice', dmRoll);
  await activity.finishTool(dmRoll.operationId);
  assert.deepEqual((await activity.snapshot(token)).rolls, []);

  await activity.beginTool('roll_dice', {
    ...dmRoll,
    operationId: 'failed-roll',
    visibility: 'party',
  });
  await activity.finishTool('failed-roll', new Error('synthetic failure'));
  const failed = (await activity.snapshot(token)).rolls[0];
  assert.equal(failed.status, 'failed');
  assert.equal(failed.total, undefined);
  assert.equal(failed.dice, undefined);
  assert.equal(failed.label, 'Dice roll');

  const reported = {
    operationId: 'reported-roll',
    expectedRevision: 1,
    reason: 'physical dice',
    expression: '1d20',
    mode: 'reported',
    reportedTotal: 13,
    purpose: 'Perception',
    visibility: 'party',
  };
  await activity.beginTool('roll_dice', reported);
  assert.equal(
    (await activity.snapshot(token)).rolls.find((roll) => roll.id === reported.operationId).mode,
    'reported',
  );
  await service.execute('roll_dice', reported);
  await activity.finishTool(reported.operationId);
  const physical = (await activity.snapshot(token)).rolls.find(
    (roll) => roll.id === reported.operationId,
  );
  assert.equal(physical.status, 'complete');
  assert.equal(physical.total, 13);
  assert.deepEqual(physical.dice, []);

  const admin = {
    operationId: 'public-admin-roll',
    expectedRevision: 2,
    reason: 'administrative public roll',
    purpose: 'world_preparation',
    ruling: 'The table requested an open roll.',
    publicExplanation: 'Rolling in the open.',
    roll: { expression: '1d20', purpose: 'Secret DC 18 perception test', visibility: 'party' },
  };
  const adminRollId = await activity.beginTool('administer_campaign', admin);
  assert.equal(adminRollId, admin.operationId);
  await service.execute('administer_campaign', admin);
  await activity.finishTool(admin.operationId);
  const administered = (await activity.snapshot(token)).rolls.find(
    (roll) => roll.id === admin.operationId,
  );
  assert.equal(administered.status, 'complete');
  assert.equal(administered.label, 'Dice roll');
  assert.equal(administered.total, administered.dice[0] + administered.modifier);
  assert.doesNotMatch(JSON.stringify(administered), /Secret DC|perception/);
});

test('new activity owner clears stale feed and foreign owner cannot read it', async (t) => {
  const { store } = await fixture(t);
  const oldToken = randomUUID();
  const oldActivity = await activityFor(store, oldToken);
  await oldActivity.reset();
  await oldActivity.beginTool('resume_campaign', {});
  assert.equal((await oldActivity.snapshot(oldToken)).phase, 'Consulting notes');
  const newToken = randomUUID();
  const newActivity = await activityFor(store, newToken);
  await newActivity.reset();
  assert.deepEqual(await oldActivity.snapshot(oldToken), { rolls: [] });
  assert.deepEqual(await newActivity.snapshot(newToken), { rolls: [] });
  const feed = JSON.parse(await readFile(join(store.root, '.dm/hotseat/activity.json'), 'utf8'));
  await writeFile(
    join(store.root, '.dm/hotseat/activity.json'),
    JSON.stringify({ ...feed, ownerToken: oldToken }),
  );
  assert.deepEqual(await newActivity.snapshot(newToken), { rolls: [] });
});

test('activity phases follow the current pending request and classify rules lookup separately', async (t) => {
  const { store, service } = await fixture(t);
  await apply(service, [{ type: 'put_entity', entity: hero }]);
  let { state } = await store.read();
  const operation = { type: 'submit', id: 'turn-a', characterId: 'hero', text: 'Look around' };
  await store.transact(
    {
      operationId: 'phase-submit',
      expectedRevision: state.revision,
      actor: 'test',
      reason: 'phase test',
    },
    { table: operation },
    () => ({ changes: [], records: [], table: operation }),
  );
  assert.equal((await store.read()).state.table.at(-1).status, 'pending');
  assert.equal((await store.read()).state.table.at(-1).id, 'turn-a');
  const token = randomUUID();
  const activity = await activityFor(store, token);
  await activity.reset();
  await activity.beginTool('search_rules', { query: 'stealth' });
  const phaseFeed = JSON.parse(
    await readFile(join(store.root, '.dm/hotseat/activity.json'), 'utf8'),
  );
  assert.deepEqual(phaseFeed.requestId, 'turn-a', JSON.stringify(phaseFeed));
  assert.equal((await activity.snapshot(token, 'turn-a')).phase, 'Checking rules');
  assert.equal((await activity.snapshot(token, 'turn-b')).phase, undefined);
  await activity.beginTool('search_campaign_history', { query: 'bridge', audience: 'party' });
  assert.equal((await activity.snapshot(token, 'turn-a')).phase, 'Consulting notes');
  assert.equal((await activity.snapshot(token, null)).phase, undefined);
});
