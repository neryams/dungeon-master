import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { fixture, hero, apply } from './helpers.mjs';
import {
  requestPlayerRoll,
  requestAdministrativePlayerRoll,
  submitPlayerRoll,
  playerRollView,
} from '../dist/desktop/player-roll.js';
import { partyState } from '../dist/domain.js';
import { CampaignStore } from '../dist/store.js';
import { gameplayFingerprint } from '../dist/review.js';

async function prepared(t) {
  const f = await fixture(t);
  await apply(f.service, [
    { type: 'put_entity', entity: hero },
    { type: 'set_party', members: ['hero'] },
  ]);
  return f;
}
function input(revision, extra = {}) {
  return {
    operationId: randomUUID(),
    expectedRevision: revision,
    reason: 'Player check',
    expression: '1d20+3',
    mode: 'normal',
    purpose: 'SECRET DC 17',
    visibility: 'party',
    characterId: 'hero',
    ...extra,
  };
}

test('pending player roll is durable, uses raw faces, and retries without rerolling', async (t) => {
  const { store } = await prepared(t);
  const before = await store.read();
  const original = input(before.state.revision);
  const fingerprint = gameplayFingerprint(before.state);
  const request = await requestPlayerRoll(store, original);
  assert.ok(request);
  assert.equal((await requestPlayerRoll(store, original)).id, request.id);
  const waiting = await CampaignStore.open(store.root);
  const pending = await waiting.read();
  assert.equal(pending.state.pendingRolls[request.id].characterId, 'hero');
  assert.equal(gameplayFingerprint(pending.state), fingerprint);
  assert.equal(partyState(pending.state).pendingRolls, undefined);
  const publicView = playerRollView(pending.state, pending.events);
  assert.equal(publicView.pendingRolls[0].label, 'Dice roll');
  await assert.rejects(submitPlayerRoll(store, { id: request.id, dice: [0] }, 'hero'));
  await assert.rejects(submitPlayerRoll(store, { id: request.id, dice: [17] }, 'other'));
  const saved = await submitPlayerRoll(store, { id: request.id, dice: [17] }, 'hero');
  assert.equal(saved.roll.total, 20);
  assert.deepEqual(saved.roll.dice, [17]);
  assert.equal(saved.roll.source, 'physical');
  const retry = await submitPlayerRoll(store, { id: request.id, dice: [17] }, 'hero');
  assert.equal(retry.duplicate, true);
  assert.deepEqual(retry.roll, saved.roll);
  await assert.rejects(submitPlayerRoll(store, { id: request.id, dice: [18] }, 'hero'));
  const done = await waiting.read();
  assert.deepEqual(done.state.pendingRolls, {});
  assert.equal(playerRollView(done.state, done.events).rollHistory.at(-1).total, 20);
});

test('digital multidice and advantage rolls retain all raw faces', async (t) => {
  const { store } = await prepared(t);
  for (const [expression, mode, faces, total] of [
    ['3d6+2', 'normal', [2, 5, 6], 15],
    ['1d20-1', 'advantage', [4, 16], 15],
    ['1d20+1', 'disadvantage', [4, 16], 5],
  ]) {
    const request = await requestPlayerRoll(
      store,
      input((await store.read()).state.revision, { expression, mode }),
    );
    const result = await submitPlayerRoll(store, { id: request.id, dice: faces });
    assert.deepEqual(result.roll.dice, faces);
    assert.equal(result.roll.total, total);
  }
  const request = await requestPlayerRoll(store, input((await store.read()).state.revision));
  const digital = await submitPlayerRoll(store, { id: request.id });
  assert.equal(digital.roll.source, 'digital');
  assert.equal(digital.roll.dice.length, 1);
  assert.ok(digital.roll.dice[0] >= 1 && digital.roll.dice[0] <= 20);
});

test('private and monster dice stay automatic; physical total cannot bypass a PC request', async (t) => {
  const { store, service } = await prepared(t);
  const revision = (await store.read()).state.revision;
  const privateInput = input(revision, { visibility: 'dm' });
  assert.equal(await requestPlayerRoll(store, privateInput), undefined);
  await service.execute('roll_dice', privateInput);
  assert.equal(await requestPlayerRoll(store, privateInput), undefined);
  assert.equal(
    await requestPlayerRoll(store, input(revision, { characterId: undefined })),
    undefined,
  );
  await assert.rejects(
    requestPlayerRoll(store, input(revision, { mode: 'reported', reportedTotal: 19 })),
  );
});

test('reviewed administrative fallback also pauses for public PC dice', async (t) => {
  const { store, service } = await prepared(t);
  await service.execute('configure_review', {
    operationId: randomUUID(),
    expectedRevision: (await store.read()).state.revision,
    reason: 'Reviewed play',
    mode: 'reviewed',
  });
  const input = {
    operationId: randomUUID(),
    expectedRevision: (await store.read()).state.revision,
    reason: 'Fallback',
    purpose: 'delegation_unavailable',
    ruling: 'Independent referee unavailable',
    publicExplanation: 'The hero checks the door.',
    changes: [],
    roll: {
      characterId: 'hero',
      expression: '1d20+2',
      mode: 'normal',
      purpose: 'Perception check',
      visibility: 'party',
    },
  };
  const request = await requestAdministrativePlayerRoll(store, input);
  assert.equal(request.admin.purpose, 'delegation_unavailable');
  const completed = await submitPlayerRoll(store, { id: request.id, dice: [12] }, 'hero');
  assert.equal(completed.roll.total, 14);
  const { events } = await store.read();
  assert.equal(events.at(-1).payload.review.type, 'admin');
  assert.equal(events.at(-1).payload.roll.source, 'physical');
  await assert.rejects(
    requestAdministrativePlayerRoll(store, {
      ...input,
      operationId: randomUUID(),
      expectedRevision: (await store.read()).state.revision,
      roll: { ...input.roll, mode: 'reported', reportedTotal: 20 },
    }),
  );
});

test('legacy visible character roster can receive a player roll without set_party', async (t) => {
  const { store, service } = await fixture(t);
  await apply(service, [{ type: 'put_entity', entity: hero }]);
  const request = await requestPlayerRoll(store, input((await store.read()).state.revision));
  assert.equal(request.characterId, 'hero');
  const result = await submitPlayerRoll(store, { id: request.id, dice: [10] });
  assert.equal(result.roll.total, 13);
});

test('invalidated reviewed requests disappear when their action is cancelled', async (t) => {
  const { store, service } = await prepared(t);
  await service.execute('configure_review', {
    operationId: randomUUID(),
    expectedRevision: (await store.read()).state.revision,
    reason: 'Reviewed play',
    mode: 'reviewed',
  });
  await service.execute('prepare_action', {
    operationId: randomUUID(),
    expectedRevision: (await store.read()).state.revision,
    reason: 'Try lock',
    actionId: 'lock-action',
    actors: ['hero'],
    targets: [],
    entityIds: [],
    intent: 'Open lock',
    circumstances: 'At the door',
  });
  await service.execute('record_action_ruling', {
    operationId: randomUUID(),
    expectedRevision: (await store.read()).state.revision,
    reason: 'Rule',
    actionId: 'lock-action',
    ruling: {
      verdict: 'allowed',
      reasoning: 'Check skill',
      citations: [{ source: 'srd-5.2.1', page: 6, reference: 'Ability Checks' }],
      missingFacts: [],
      costs: 'None',
      procedure: 'Roll',
      success: 'Open',
      failure: 'Stay shut',
      rolls: [
        {
          id: 'check',
          expression: '1d20+3',
          mode: 'normal',
          purpose: 'Perception check',
          visibility: 'party',
          when: 'Now',
          optional: false,
        },
      ],
      referee: { host: 'test', model: 'test' },
    },
  });
  const request = await requestPlayerRoll(
    store,
    input((await store.read()).state.revision, {
      actionId: 'lock-action',
      stepId: 'check',
      purpose: 'Perception check',
      characterId: undefined,
    }),
  );
  assert.equal(request.characterId, 'hero');
  await assert.rejects(
    requestPlayerRoll(
      store,
      input((await store.read()).state.revision, {
        actionId: 'lock-action',
        stepId: 'check',
        purpose: 'Perception check',
        characterId: undefined,
      }),
    ),
  );
  await service.execute('cancel_action', {
    operationId: randomUUID(),
    expectedRevision: (await store.read()).state.revision,
    reason: 'Cancel',
    actionId: 'lock-action',
  });
  assert.equal((await store.read()).state.pendingRolls[request.id], undefined);
  await assert.rejects(submitPlayerRoll(store, { id: request.id, dice: [11] }));
});
