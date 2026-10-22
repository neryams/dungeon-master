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
  };
  await dispatchDesktop(api, 'connect', []);
  await dispatchDesktop(api, 'connect', [true]);
  await dispatchWorker(api, 'connect', [null, true]); // JSON IPC encodes optional array entries as null.
  await dispatchWorker(api, 'detect', [null]);
  assert.deepEqual(calls, [
    ['connect'],
    ['connect', true],
    ['connect', undefined, true, undefined],
    ['detect', undefined],
  ]);
  for (const [method, args] of [
    ['open', [42]],
    ['snapshot', ['extra']],
    ['connect', ['path', true]],
    ['__proto__', []],
    ['tableChange', [{}]],
    ['lanAdmin', [{ action: 'assign', clientId: 'player' }]],
    ['lanAdmin', [{ action: 'remove', clientId: 'player', characterId: 'hero' }]],
  ]) {
    await assert.rejects(dispatchDesktop(api, method, args));
  }
  assert.equal(calls.length, 4, 'Malformed requests must never invoke handlers');
  assert.equal(WorkerEnvelope.safeParse({ id: 1, method: 'snapshot', args: [] }).success, true);
  assert.equal(WorkerEnvelope.safeParse({ id: '1', method: 'snapshot', args: [] }).success, false);
  assert.equal(LanAdminInput.safeParse({ action: 'skip', characterId: 'hero' }).success, true);
});
