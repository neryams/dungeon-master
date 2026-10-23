import test from 'node:test';
import assert from 'node:assert/strict';
import {
  dispatchDesktop,
  dispatchWorker,
  LanAdminInput,
  WorkerEnvelope,
} from '../dist/desktop/contracts.js';

test('typed bridge validates methods, argument arity and administration payloads', async () => {
  const calls = [];
  const api = {
    connect: async (...args) => {
      calls.push(['connect', ...args]);
      return { connected: true, path: 'agy', version: 'fixture' };
    },
    models: async (...args) => {
      calls.push(['models', ...args]);
      return { models: [{ id: 'gpt-6-sol', name: 'GPT-6 Sol' }] };
    },
    selectModel: async (...args) => calls.push(['selectModel', ...args]),
    switchModel: async (...args) => calls.push(['switchModel', ...args]),
    detect: async (...args) => {
      calls.push(['detect', ...args]);
      return { path: 'agy', version: 'fixture' };
    },
    open: async (...args) => {
      calls.push(['open', ...args]);
    },
    lanAdmin: async (...args) => {
      calls.push(['lanAdmin', ...args]);
    },
    snapshot: async () => {
      calls.push(['snapshot']);
      return { campaign: null };
    },
    beginSetup: async () => calls.push(['beginSetup']),
  };
  await dispatchDesktop(api, 'connect', []);
  await dispatchDesktop(api, 'connect', [true]);
  await dispatchWorker(api, 'connect', [null, true]); // JSON IPC encodes optional array entries as null.
  await dispatchWorker(api, 'detect', [null]);
  await dispatchWorker(api, 'models', [null, 'codex', null]);
  await dispatchDesktop(api, 'models', []);
  await dispatchDesktop(api, 'selectModel', ['gpt-6-sol']);
  await dispatchDesktop(api, 'switchModel', ['gpt-6-astra']);
  await dispatchWorker(api, 'connect', [null, false, 'codex', null, 'gpt-6-astra']);
  assert.deepEqual(calls, [
    ['connect'],
    ['connect', true],
    ['connect', undefined, true, undefined],
    ['detect', undefined],
    ['models', undefined, 'codex', undefined],
    ['models'],
    ['selectModel', 'gpt-6-sol'],
    ['switchModel', 'gpt-6-astra'],
    ['connect', undefined, false, 'codex', undefined, 'gpt-6-astra'],
  ]);
  await dispatchDesktop(api, 'beginSetup', []);
  assert.deepEqual(calls.at(-1), ['beginSetup']);
  for (const [method, args] of [
    ['open', [42]],
    ['snapshot', ['extra']],
    ['beginSetup', ['extra']],
    ['connect', ['path', true]],
    ['connect', ['path', false, 'codex', null, 'not a model id']],
    ['models', ['path', 'unknown-provider']],
    ['selectModel', ['not a model id']],
    ['switchModel', [{}]],
    ['__proto__', []],
    ['tableChange', [{}]],
    ['lanAdmin', [{ action: 'assign', clientId: 'player' }]],
    ['lanAdmin', [{ action: 'remove', clientId: 'player', characterId: 'hero' }]],
  ]) {
    await assert.rejects(dispatchDesktop(api, method, args));
  }
  assert.equal(calls.length, 10, 'Malformed requests must never invoke handlers');
  assert.equal(WorkerEnvelope.safeParse({ id: 1, method: 'snapshot', args: [] }).success, true);
  assert.equal(WorkerEnvelope.safeParse({ id: '1', method: 'snapshot', args: [] }).success, false);
  assert.equal(LanAdminInput.safeParse({ action: 'skip', characterId: 'hero' }).success, true);
});
