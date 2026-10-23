import test from 'node:test';
import assert from 'node:assert/strict';
import { join, resolve } from 'node:path';
import { readFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { DesktopHost } from '../dist/desktop/host.js';
import { fixture } from './helpers.mjs';

function fakeDriver(seen, options, { fail = false, block } = {}) {
  return {
    run: async () => {
      seen.push(options);
      await options.onConversation(options.conversationId ?? `thread-${seen.length}`);
      if (block) await block.promise;
      if (fail) throw new Error('synthetic connection failure');
      return { tools: [], campaignIds: ['test'] };
    },
    close: async () => block?.reject?.(new Error('closed')),
  };
}

async function hosted(t, { driver, modelProbe } = {}) {
  const { store } = await fixture(t);
  const host = new DesktopHost({
    source: resolve('.'),
    probe: async () => ({ path: process.execPath, version: 'fixture' }),
    modelProbe,
    driver,
  });
  t.after(() => host.close());
  await host.open(store.root);
  return { host, store };
}

test('hosted model selection is passed to the driver and the same model resumes its locator', async (t) => {
  const seen = [];
  const { host } = await hosted(t, {
    driver: (options) => fakeDriver(seen, options),
    modelProbe: async () => ({
      models: [{ id: 'vendor.dm:latest', name: 'DM' }],
      defaultModel: 'vendor.dm:latest',
    }),
  });
  await host.connect(undefined, false, 'codex', undefined, 'vendor.dm:latest');
  await host.connect(undefined, false, 'codex', undefined, 'vendor.dm:latest');
  assert.deepEqual(await host.models(undefined, 'codex'), {
    models: [{ id: 'vendor.dm:latest', name: 'DM' }],
    defaultModel: 'vendor.dm:latest',
  });
  assert.deepEqual(
    seen.map((options) => [options.model, options.conversationId]),
    [
      ['vendor.dm:latest', undefined],
      ['vendor.dm:latest', 'thread-1'],
    ],
  );
  const locator = JSON.parse(
    await readFile(join((await host.snapshot()).root, '.dm/hotseat/codex-session.json'), 'utf8'),
  );
  assert.equal(locator.model, 'vendor.dm:latest');
  assert.equal((await host.snapshot()).model, 'vendor.dm:latest');
});

test('changing hosted model starts a new context, removes stale locator, and leaves campaign history intact', async (t) => {
  const seen = [];
  const { host, store } = await hosted(t, { driver: (options) => fakeDriver(seen, options) });
  await host.connect(undefined, false, 'codex', undefined, 'first-model');
  const events = await store.events();
  const before = (await store.read()).state;
  await host.connect(undefined, false, 'codex', undefined, 'second-model');
  assert.deepEqual(
    seen.map((options) => options.conversationId),
    [undefined, undefined],
  );
  assert.deepEqual(await store.events(), events);
  assert.deepEqual((await store.read()).state, before);
  const locator = JSON.parse(
    await readFile(join((await host.snapshot()).root, '.dm/hotseat/codex-session.json'), 'utf8'),
  );
  assert.equal(locator.model, 'second-model');
});

test('old default-model locator remains resumable when no model is selected', async (t) => {
  const seen = [];
  const { host } = await hosted(t, { driver: (options) => fakeDriver(seen, options) });
  await host.connect(undefined, false, 'codex');
  await host.connect(undefined, false, 'codex');
  assert.deepEqual(
    seen.map((options) => [options.model, options.conversationId]),
    [
      [undefined, undefined],
      [undefined, 'thread-1'],
    ],
  );
});

test('busy model switch is rejected before changing its locator', async (t) => {
  const seen = [];
  let release;
  const block = { promise: new Promise((resolve) => (release = resolve)) };
  const { host } = await hosted(t, {
    driver: (options) => fakeDriver(seen, options, { block: seen.length ? block : undefined }),
  });
  await host.connect(undefined, false, 'codex', undefined, 'first-model');
  const locatorPath = join((await host.snapshot()).root, '.dm/hotseat/codex-session.json');
  const original = await readFile(locatorPath, 'utf8');
  const action = host.submit({ id: 'busy-request', text: 'Wait for an answer' });
  for (let i = 0; i < 100 && (await host.snapshot()).stage !== 'resolving'; i++) await delay(5);
  await assert.rejects(host.connect(undefined, true, 'codex', undefined, 'second-model'), /busy/);
  assert.equal(await readFile(locatorPath, 'utf8'), original);
  release();
  await action;
  await host.stop();
});

test('failed connection after a model change never resumes or replays the previous conversation', async (t) => {
  const seen = [];
  let calls = 0;
  const { host } = await hosted(t, {
    driver: (options) => fakeDriver(seen, options, { fail: ++calls === 2 }),
  });
  await host.connect(undefined, false, 'codex', undefined, 'first-model');
  await assert.rejects(
    host.connect(undefined, false, 'codex', undefined, 'second-model'),
    /synthetic connection failure/,
  );
  assert.deepEqual(
    seen.map((options) => options.conversationId),
    [undefined, undefined],
  );
  await host.connect(undefined, false, 'codex', undefined, 'second-model');
  assert.notEqual(seen[2].conversationId, 'thread-1');
});
