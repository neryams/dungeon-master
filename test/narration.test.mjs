import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';
import { NarrationController } from '../build/desktop/narration.js';

const message = (id, overrides = {}) => ({
  id,
  campaignId: 'campaign-a',
  turnId: `turn-${id}`,
  revision: Number(id.replace(/\D/g, '')) || 1,
  eligible: true,
  ...overrides,
});

const snapshot = (messages, overrides = {}) => ({
  campaignKey: 'campaign-a',
  active: true,
  messages,
  ...overrides,
});

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function until(predicate, messageText = 'condition was not reached') {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await delay(2);
  }
  assert.fail(messageText);
}

function harness(overrides = {}, options = {}) {
  const calls = { synthesize: [], played: [], stopped: 0, canceled: 0, states: [] };
  const dependencies = {
    async synthesize(item, voice, part) {
      calls.synthesize.push({ id: item.id, voice, part });
      return { audio: `${item.id}:${part}` };
    },
    cancelSynthesis() {
      calls.canceled += 1;
    },
    async play(audio) {
      calls.played.push(audio);
    },
    stopAudio() {
      calls.stopped += 1;
    },
    onChange(state) {
      calls.states.push(state);
    },
    ...overrides,
  };
  return {
    calls,
    controller: new NarrationController(dependencies, { voice: 'Easton', ...options }),
  };
}

test('reset seeds old history and polling the same messages does not replay them', async () => {
  const { controller, calls } = harness();
  const old = message('old');
  controller.reset(snapshot([old]));
  controller.observe(snapshot([old]));
  await delay(5);
  assert.deepEqual(calls.synthesize, []);
  assert.equal(controller.getState().activity, 'idle');
});

test('reset clears queued messages from the previous campaign generation', async () => {
  const pending = deferred();
  const { controller, calls } = harness({
    synthesize(item, voice, part) {
      calls.synthesize.push({ id: item.id, voice, part });
      return item.id === 'old-current' ? pending.promise : Promise.resolve({ audio: item.id });
    },
  });
  controller.reset(snapshot([]));
  controller.observe(snapshot([message('old-current'), message('old-queued')]));
  await until(() => calls.synthesize.length === 1);
  controller.reset(snapshot([], { campaignKey: 'campaign-b' }));
  pending.resolve({ audio: 'stale' });
  const next = message('new', { campaignId: 'campaign-b' });
  controller.observe(snapshot([next], { campaignKey: 'campaign-b' }));
  await until(() => calls.played.length === 1);
  assert.deepEqual(
    calls.synthesize.map((call) => call.id),
    ['old-current', 'new'],
  );
  assert.deepEqual(calls.played, ['new']);
});

test('all observations are marked seen while inactive or muted, then only new eligible messages queue', async () => {
  const { controller, calls } = harness({}, { enabled: false });
  const setup = message('setup', { eligible: false });
  const muted = message('muted');
  controller.reset(snapshot([], { active: false }));
  controller.observe(snapshot([setup, muted], { active: true }));
  controller.setEnabled(true);
  controller.observe(snapshot([setup, muted, message('new')]));
  await until(() => calls.played.length === 1);
  assert.deepEqual(
    calls.synthesize.map((call) => call.id),
    ['new'],
  );
});

test('new messages play once in transcript order and repeated polls do not duplicate them', async () => {
  const { controller, calls } = harness();
  controller.reset(snapshot([]));
  const messages = [message('1'), message('2'), message('3')];
  controller.observe(snapshot(messages));
  controller.observe(snapshot(messages));
  await until(() => calls.played.length === 3);
  assert.deepEqual(
    calls.synthesize.map((call) => call.id),
    ['1', '2', '3'],
  );
  assert.deepEqual(calls.played, ['1:0', '2:0', '3:0']);
});

test('skip during synthesis cancels before starting the next message and ignores the late result', async () => {
  const pending = deferred();
  const { controller, calls } = harness({
    synthesize(item, voice, part) {
      calls.synthesize.push({ id: item.id, voice, part });
      if (item.id === '1') return pending.promise;
      assert.ok(calls.canceled >= 1, 'cancellation must finish before the next synthesis');
      return Promise.resolve({ audio: `${item.id}:${part}` });
    },
  });
  controller.reset(snapshot([]));
  controller.observe(snapshot([message('1'), message('2')]));
  await until(() => calls.synthesize.length === 1);
  controller.skip();
  pending.resolve({ audio: 'stale' });
  await until(() => calls.played.length === 1);
  assert.deepEqual(calls.played, ['2:0']);
  assert.deepEqual(
    calls.synthesize.map((call) => call.id),
    ['1', '2'],
  );
});

test('mute stops active audio immediately, clears the queue, and does not replay on unmute', async () => {
  const playing = deferred();
  const { controller, calls } = harness({
    play(audio) {
      calls.played.push(audio);
      return playing.promise;
    },
  });
  controller.reset(snapshot([]));
  controller.observe(snapshot([message('1'), message('2')]));
  await until(() => calls.played.length === 1);
  const before = calls.stopped;
  controller.setEnabled(false);
  assert.equal(calls.stopped, before + 1);
  playing.resolve();
  controller.setEnabled(true);
  controller.observe(snapshot([message('1'), message('2')]));
  await delay(5);
  assert.deepEqual(
    calls.synthesize.map((call) => call.id),
    ['1'],
  );
  assert.equal(controller.getState().enabled, true);
  assert.equal(controller.getState().activity, 'idle');
});

test('manual replay works while muted without changing the preference', async () => {
  const playing = deferred();
  const { controller, calls } = harness(
    {
      play(audio) {
        calls.played.push(audio);
        return playing.promise;
      },
    },
    { enabled: false },
  );
  const item = message('1', { eligible: false });
  controller.reset(snapshot([item]));
  controller.replay(item);
  await until(() => calls.played.length === 1);
  assert.equal(controller.getState().enabled, false);
  const stopped = calls.stopped;
  controller.setEnabled(false);
  assert.equal(calls.stopped, stopped + 1, 'mute remains an immediate stop while already muted');
  playing.resolve();
  await delay(5);
  assert.deepEqual(calls.played, ['1:0']);
  assert.equal(controller.getState().activity, 'idle');
});

test('skip drops remaining chunks of the current message and advances the queue', async () => {
  const firstAudio = deferred();
  const { controller, calls } = harness({
    synthesize(item, voice, part) {
      calls.synthesize.push({ id: item.id, voice, part });
      return Promise.resolve(
        item.id === '1' && part === 0
          ? { audio: '1:first', nextPart: 1 }
          : { audio: `${item.id}:${part}` },
      );
    },
    play(audio) {
      calls.played.push(audio);
      return audio === '1:first' ? firstAudio.promise : Promise.resolve();
    },
  });
  controller.reset(snapshot([]));
  controller.observe(snapshot([message('1'), message('2')]));
  await until(() => calls.played.includes('1:first'));
  controller.skip();
  firstAudio.resolve();
  await until(() => calls.played.includes('2:0'));
  assert.deepEqual(
    calls.synthesize.map((call) => `${call.id}:${call.part}`),
    ['1:0', '2:0'],
  );
});

test('replay replaces current playback, and voice changes discard pending speech', async () => {
  const playing = deferred();
  const { controller, calls } = harness({
    play(audio) {
      calls.played.push(audio);
      if (audio === '1:0') return playing.promise;
      return Promise.resolve();
    },
  });
  controller.reset(snapshot([]));
  const first = message('1');
  const second = message('2');
  controller.observe(snapshot([first, second]));
  await until(() => calls.played.length === 1);
  controller.replay(first);
  await until(() => calls.played.length === 2);
  controller.setVoice('Zoey');
  playing.resolve();
  controller.replay(second);
  await until(() => calls.synthesize.at(-1)?.voice === 'Zoey');
  await until(() => controller.getState().activity === 'idle');
  assert.deepEqual(
    calls.synthesize.map((call) => `${call.id}:${call.voice}`),
    ['1:Easton', '1:Easton', '2:Zoey'],
  );
});

test('campaign changes establish a fresh baseline and leaving invalidates late work', async () => {
  const pending = deferred();
  const { controller, calls } = harness({
    synthesize(item, voice, part) {
      calls.synthesize.push({ id: item.id, voice, part });
      return item.id === 'new' ? pending.promise : Promise.resolve({ audio: item.id });
    },
  });
  controller.reset(snapshot([]));
  controller.observe(snapshot([message('old')]));
  await until(() => calls.played.length === 1);
  const otherCampaign = message('new', { campaignId: 'campaign-b' });
  controller.observe(snapshot([otherCampaign], { campaignKey: 'campaign-b' }));
  await delay(5);
  assert.deepEqual(
    calls.synthesize.map((call) => call.id),
    ['old'],
  );
  controller.reset(snapshot([], { campaignKey: 'campaign-b' }));
  controller.observe(snapshot([otherCampaign], { campaignKey: 'campaign-b' }));
  await until(() => calls.synthesize.length === 2);
  controller.leave();
  pending.resolve({ audio: 'late' });
  await delay(5);
  assert.deepEqual(calls.played, ['old']);
  assert.equal(controller.getState().activity, 'idle');
});

test('synthesis or playback errors are reported once without replaying on polling', async () => {
  const { controller, calls } = harness({
    synthesize(item, voice, part) {
      calls.synthesize.push({ id: item.id, voice, part });
      throw new Error('local voice unavailable');
    },
  });
  controller.reset(snapshot([]));
  const item = message('1');
  controller.observe(snapshot([item]));
  await until(() => controller.getState().activity === 'error');
  controller.observe(snapshot([item]));
  await delay(5);
  assert.equal(calls.synthesize.length, 1);
  assert.equal(controller.getState().error, 'local voice unavailable');
});
