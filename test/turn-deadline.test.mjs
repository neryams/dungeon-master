import test from 'node:test';
import assert from 'node:assert/strict';
import { AgentTimeoutError, TurnDeadline } from '../dist/desktop/turn-deadline.js';

async function flushMicrotasks() {
  for (let i = 0; i < 8; i++) await Promise.resolve();
}

test('deadline expires when no authoritative final response was saved', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let graceCalls = 0;
  let checks = 0;
  let timeoutCalls = 0;
  const deadline = new TurnDeadline({
    timeoutMs: 5,
    requestId: 'request-1',
    hasPublishedResponse: async (requestId) => {
      assert.equal(requestId, 'request-1');
      checks++;
      return false;
    },
    onFinishingGrace: () => graceCalls++,
    onTimeout: () => timeoutCalls++,
  });
  deadline.start();
  t.mock.timers.tick(5);
  await flushMicrotasks();
  assert.equal(checks, 1);
  assert.equal(graceCalls, 0);
  assert.equal(timeoutCalls, 1);
});

test('a saved final response grants exactly one finishing grace and reports it', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let graceCalls = 0;
  let timeoutCalls = 0;
  let resolvePublication;
  const deadline = new TurnDeadline({
    timeoutMs: 5,
    finishingGraceMs: 25,
    requestId: 'request-2',
    hasPublishedResponse: () =>
      new Promise((resolve) => {
        resolvePublication = resolve;
      }),
    onFinishingGrace: () => graceCalls++,
    onTimeout: () => timeoutCalls++,
  });
  deadline.start();
  t.mock.timers.tick(5);
  await flushMicrotasks();
  assert.equal(graceCalls, 0);
  resolvePublication(true);
  await flushMicrotasks();
  assert.equal(graceCalls, 1);
  assert.equal(timeoutCalls, 0);
  t.mock.timers.tick(24);
  assert.equal(timeoutCalls, 0);
  t.mock.timers.tick(1);
  await flushMicrotasks();
  assert.equal(graceCalls, 1);
  assert.equal(timeoutCalls, 1);
  deadline.cancel();
});

test('cancellation wins while an authoritative publication check is in flight', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let timedOut = false;
  let resolvePublication;
  const deadline = new TurnDeadline({
    timeoutMs: 5,
    requestId: 'request-3',
    hasPublishedResponse: () =>
      new Promise((resolve) => {
        resolvePublication = resolve;
      }),
    onTimeout: () => (timedOut = true),
  });
  deadline.start();
  t.mock.timers.tick(5);
  await flushMicrotasks();
  deadline.cancel();
  resolvePublication(true);
  await flushMicrotasks();
  t.mock.timers.tick(500);
  assert.equal(timedOut, false);
});

test('cancellation during finishing grace prevents timeout', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let timeoutCalls = 0;
  const deadline = new TurnDeadline({
    timeoutMs: 5,
    finishingGraceMs: 25,
    requestId: 'request-3b',
    hasPublishedResponse: async () => true,
    onTimeout: () => timeoutCalls++,
  });
  deadline.start();
  t.mock.timers.tick(5);
  await flushMicrotasks();
  deadline.cancel();
  t.mock.timers.tick(100);
  assert.equal(timeoutCalls, 0);
});

test('a stuck publication lookup cannot extend the timeout check indefinitely', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let timedOut = false;
  const deadline = new TurnDeadline({
    timeoutMs: 5,
    requestId: 'request-4',
    hasPublishedResponse: () => new Promise(() => {}),
    onTimeout: () => (timedOut = true),
  });
  deadline.start();
  t.mock.timers.tick(5);
  await flushMicrotasks();
  assert.equal(timedOut, false);
  t.mock.timers.tick(999);
  await flushMicrotasks();
  assert.equal(timedOut, false);
  t.mock.timers.tick(1);
  await flushMicrotasks();
  assert.equal(timedOut, true);
});

test('provider timeout failures use the shared typed error', () => {
  const error = new AgentTimeoutError('Codex');
  assert.equal(error.name, 'AgentTimeoutError');
  assert.match(error.message, /Codex timed out/);
  assert.ok(error instanceof Error);
});

test('waiting for player dice defers timeout, then resumes the ordinary deadline', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let waiting = true;
  let timedOut = 0;
  const deadline = new TurnDeadline({
    timeoutMs: 10,
    requestId: 'dice-request',
    isAwaitingPlayerRoll: async (id) => {
      assert.equal(id, 'dice-request');
      return waiting;
    },
    onTimeout: () => timedOut++,
  });
  deadline.start();
  t.mock.timers.tick(10);
  await flushMicrotasks();
  assert.equal(timedOut, 0);
  waiting = false;
  t.mock.timers.tick(10);
  await flushMicrotasks();
  assert.equal(timedOut, 1);
});

test('cancellation wins over a pending player dice lookup', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let resolveWaiting;
  let timedOut = false;
  const deadline = new TurnDeadline({
    timeoutMs: 5,
    requestId: 'dice-request',
    isAwaitingPlayerRoll: () =>
      new Promise((resolve) => {
        resolveWaiting = resolve;
      }),
    onTimeout: () => (timedOut = true),
  });
  deadline.start();
  t.mock.timers.tick(5);
  await flushMicrotasks();
  deadline.cancel();
  resolveWaiting(true);
  await flushMicrotasks();
  t.mock.timers.tick(100);
  assert.equal(timedOut, false);
});

test('a stalled player dice lookup cannot disable the provider deadline', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let timedOut = false;
  const deadline = new TurnDeadline({
    timeoutMs: 5,
    requestId: 'dice-request',
    isAwaitingPlayerRoll: () => new Promise(() => {}),
    onTimeout: () => (timedOut = true),
  });
  deadline.start();
  t.mock.timers.tick(5);
  await flushMicrotasks();
  t.mock.timers.tick(1000);
  await flushMicrotasks();
  assert.equal(timedOut, true);
});
