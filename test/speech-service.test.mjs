import test from 'node:test';
import assert from 'node:assert/strict';
import { SpeechService } from '../dist/desktop/speech-service.js';

function setup() {
  let key = null;
  let unreadable = false;
  const notifications = [],
    recordings = [],
    requests = [];
  const credentials = {
    status: async () => ({ configured: key !== null, unreadable }),
    load: async () => {
      if (unreadable) throw new Error('Locked');
      return key;
    },
    save: async (next) => {
      key = next;
    },
    remove: async () => {
      key = null;
    },
  };
  const engine = {
    synthesize: (...args) =>
      new Promise((resolve, reject) => requests.push({ args, resolve, reject })),
    transcribe: (...args) =>
      new Promise((resolve, reject) => requests.push({ args, resolve, reject })),
  };
  const service = new SpeechService(
    credentials,
    engine,
    (s) => notifications.push(s),
    (s) => recordings.push(s),
  );
  return {
    service,
    credentials,
    requests,
    notifications,
    recordings,
    lock: () => {
      unreadable = true;
    },
  };
}
async function until(fn) {
  for (let i = 0; i < 50; i++) {
    if (fn()) return;
    await new Promise((r) => setImmediate(r));
  }
  assert.fail('Expected request');
}

test('saved key enables speech without inference and never appears in status', async () => {
  const f = setup();
  assert.equal((await f.service.settings()).available, false);
  await f.service.save('synthetic-key');
  assert.equal((await f.service.settings()).available, true);
  assert.equal(f.requests.length, 0);
  assert.doesNotMatch(JSON.stringify(f.notifications), /synthetic-key/);
  f.lock();
  assert.equal((await f.service.settings()).configured, true);
  assert.equal((await f.service.settings()).available, false);
});

test('removal cancels synthesis and prevents late audio after remote completion', async () => {
  const f = setup();
  await f.service.save('synthetic-key');
  const pending = f.service.speak('Kore', async () => ({ text: 'The road opens.' }));
  await until(() => f.requests.length === 1);
  const rejected = assert.rejects(pending, /cancelled/);
  await f.service.remove();
  assert.equal(f.requests[0].args[3].aborted, true);
  f.requests[0].resolve('stale-audio');
  await rejected;
  assert.equal((await f.service.settings()).available, false);
});

test('cancel owner stops transcription but leaves other owners intact', async () => {
  const f = setup();
  await f.service.save('synthetic-key');
  const a = f.service.transcribe(1, { audio: 'eA==', mimeType: 'audio/webm' });
  const b = f.service.transcribe(2, { audio: 'eA==', mimeType: 'audio/webm' });
  await until(() => f.requests.length === 2);
  const rejected = assert.rejects(a, /cancelled/);
  f.service.cancelOwner(1);
  assert.equal(f.requests[0].args[3].aborted, true);
  assert.equal(f.requests[1].args[3].aborted, false);
  f.requests[0].resolve('stale');
  f.requests[1].resolve('Open the gate.');
  await rejected;
  assert.deepEqual(await b, { text: 'Open the gate.' });
});

test('recording suspends narration and only one player records at once', async () => {
  const f = setup();
  await f.service.save('synthetic-key');
  await f.service.setRecording(1, true);
  await assert.rejects(
    f.service.speak('Kore', async () => ({ text: 'Hello' })),
    /paused/,
  );
  await assert.rejects(f.service.setRecording(2, true), /Another player/);
  f.service.cancelOwner(1);
  await f.service.setRecording(2, true);
  await f.service.setRecording(2, false);
  assert.equal(f.recordings.at(-1), false);
});

test('failed replacement preserves the existing key and releases settings lock', async () => {
  const f = setup();
  await f.service.save('old-synthetic-key');
  f.credentials.save = async () => {
    throw new Error('Disk unavailable');
  };
  await assert.rejects(f.service.save('new-synthetic-key'), /Disk/);
  assert.equal((await f.service.settings()).available, true);
  const p = f.service.speak('Kore', async () => ({ text: 'Hello' }));
  await until(() => f.requests.length === 1);
  assert.equal(f.requests[0].args[0], 'old-synthetic-key');
  f.requests[0].resolve('wav');
  assert.deepEqual(await p, { audio: 'wav' });
});

test('cancel recording wins over pending credential unlock', async () => {
  const f = setup();
  await f.service.save('synthetic-key');
  let release;
  f.credentials.status = () =>
    new Promise((resolve) => {
      release = resolve;
    });
  const starting = f.service.setRecording(1, true);
  await until(() => release);
  await f.service.setRecording(1, false);
  release({ configured: true, unreadable: false });
  await starting;
  assert.equal(f.recordings.at(-1), false);
});

test('replacement notifies windows to stop playback before installing the new key', async () => {
  const f = setup();
  await f.service.save('old-synthetic-key');
  f.notifications.length = 0;
  await f.service.save('new-synthetic-key');
  assert.equal(f.notifications[0].available, false);
  assert.equal(f.notifications.at(-1).available, true);
});
