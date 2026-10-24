import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { apply, fixture, hero } from './helpers.mjs';
import { hasPublishedResponse } from '../dist/table.js';

async function finish(store, requestId, status = 'completed') {
  const { state } = await store.read();
  return store.transact(
    {
      operationId: randomUUID(),
      expectedRevision: state.revision,
      actor: 'test',
      reason: 'Finish table request',
    },
    { table: { type: 'finish', requestId, status } },
    () => ({ changes: [], records: [], table: { type: 'finish', requestId, status } }),
  );
}

test('progress publications remain visible but cannot complete a turn; a final response can', async (t) => {
  const { store, service } = await fixture(t);
  await apply(service, [{ type: 'put_entity', entity: hero }]);
  const { state } = await store.read();
  await store.transact(
    {
      operationId: 'submit-progress-test',
      expectedRevision: state.revision,
      actor: 'test',
      reason: 'Submit',
    },
    { table: { type: 'submit', id: 'turn-progress', characterId: 'hero', text: 'Open the gate.' } },
    () => ({
      changes: [],
      records: [],
      table: { type: 'submit', id: 'turn-progress', characterId: 'hero', text: 'Open the gate.' },
    }),
  );

  const publish = async (operationId, fields) => {
    const { state: current } = await store.read();
    return service.execute('publish_table_message', {
      operationId,
      expectedRevision: current.revision,
      reason: 'Public table narration',
      requestId: 'turn-progress',
      ...fields,
    });
  };

  await publish('progress-beat', {
    text: 'The old hinges groan as the gate begins to rise.',
    delivery: 'progress',
  });
  let turn = (await store.read()).state.table[0];
  assert.equal(turn.messages[0].delivery, 'progress');
  assert.equal(hasPublishedResponse(turn), false);
  await assert.rejects(finish(store, turn.id), /public response/);
  await assert.rejects(
    publish('invalid-progress-prompt', {
      text: 'A guard points at Mira.',
      delivery: 'progress',
      responseRequest: { characterIds: ['hero'], prompt: 'What do you do?', kind: 'decision' },
    }),
    /Progress messages cannot request a player response/,
  );

  await publish('final-response', {
    text: 'Beyond the gate, a guard blocks the passage. What do you do?',
    responseRequest: { characterIds: ['hero'], prompt: 'What do you do?', kind: 'decision' },
  });
  turn = (await store.read()).state.table[0];
  assert.equal(turn.messages[1].delivery, 'response');
  assert.equal(hasPublishedResponse(turn), true);
  await finish(store, turn.id);
  const completed = (await store.read()).state;
  assert.equal(completed.table[0].status, 'completed');
  assert.deepEqual(completed.gathering.request, {
    characterIds: ['hero'],
    prompt: 'What do you do?',
    kind: 'decision',
  });
});

test('legacy table messages without a delivery marker count as completed responses', () => {
  assert.equal(
    hasPublishedResponse({ messages: [{ text: 'The gate is open.', revision: 3 }] }),
    true,
  );
  assert.equal(
    hasPublishedResponse({
      messages: [{ text: 'The gate moves.', revision: 3, delivery: 'progress' }],
    }),
    false,
  );
});
