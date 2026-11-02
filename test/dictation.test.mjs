import assert from 'node:assert/strict';
import test from 'node:test';
import { DictationController } from '../build/desktop/dictation.js';

globalThis.window = { setTimeout, clearTimeout };
const wait = () => new Promise((resolve) => setTimeout(resolve, 0));
function deferred() {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
class TestFileReader {
  readAsDataURL(blob) {
    void blob.arrayBuffer().then((buffer) => {
      this.result = `data:audio/webm;base64,${Buffer.from(buffer).toString('base64')}`;
      this.onload();
    });
  }
}
globalThis.FileReader = TestFileReader;

function recorderWith(data) {
  return () => ({
    state: 'inactive',
    start(timeslice) {
      this.state = 'recording';
      this.timeslice = timeslice;
    },
    stop() {
      this.state = 'inactive';
      this.ondataavailable({ data });
      this.onstop();
    },
  });
}
function streamWith(stop) {
  return { getTracks: () => [{ stop }] };
}

test('cancel while microphone permission is pending releases the late stream and does not transcribe', async () => {
  const permission = deferred();
  const calls = [];
  let stopped = 0;
  const controller = new DictationController({
    api: {
      async setRecording(active) {
        calls.push(['recording', active]);
      },
      async cancelTranscription() {
        calls.push(['cancel']);
      },
      async transcribe() {
        calls.push(['transcribe']);
        return { text: 'unexpected' };
      },
    },
    mediaDevices: { getUserMedia: () => permission.promise },
    onState() {},
    append() {},
  });
  const starting = controller.start();
  await wait();
  await controller.cancel();
  permission.resolve(
    streamWith(() => {
      stopped += 1;
    }),
  );
  await starting;
  assert.equal(stopped, 1);
  assert.deepEqual(
    calls.filter((call) => call[0] === 'recording').map((call) => call[1]),
    [true, false],
  );
  assert.equal(
    calls.some((call) => call[0] === 'transcribe'),
    false,
  );
  assert.equal(controller.getState().status, 'idle');
});

test('oversized recording cancels without transcription and reports its size limit', async () => {
  const calls = [];
  let stopped = 0;
  let startedWith;
  const controller = new DictationController({
    api: {
      async setRecording(active) {
        calls.push(['recording', active]);
      },
      async cancelTranscription() {
        calls.push(['cancel']);
      },
      async transcribe() {
        calls.push(['transcribe']);
        return { text: '' };
      },
    },
    mediaDevices: {
      getUserMedia: async () =>
        streamWith(() => {
          stopped += 1;
        }),
    },
    recorderFactory: () => ({
      state: 'inactive',
      start(timeslice) {
        startedWith = timeslice;
        this.state = 'recording';
      },
      stop() {
        this.state = 'inactive';
        this.ondataavailable({ data: new Blob(['123456']) });
        this.onstop();
      },
    }),
    maxBytes: 5,
    onState() {},
    append() {},
  });
  await controller.start();
  await controller.stop();
  await wait();
  assert.equal(startedWith, 1000);
  assert.equal(stopped, 1);
  assert.equal(controller.getState().status, 'error');
  assert.match(controller.getState().error, /10 MB/);
  assert.equal(
    calls.some((call) => call[0] === 'transcribe'),
    false,
  );
});

test('a valid recording sends WebM audio, appends the transcript and releases the microphone', async () => {
  const calls = [];
  const appended = [];
  let stopped = 0;
  const controller = new DictationController({
    api: {
      async setRecording(active) {
        calls.push(['recording', active]);
      },
      async cancelTranscription() {},
      async transcribe(input) {
        calls.push(['transcribe', input]);
        return { text: '  A careful plan.  ' };
      },
    },
    mediaDevices: {
      getUserMedia: async () =>
        streamWith(() => {
          stopped += 1;
        }),
    },
    recorderFactory: recorderWith(new Blob(['audio data'])),
    onState() {},
    append: (text) => appended.push(text),
  });
  await controller.start();
  await controller.stop();
  await wait();
  assert.deepEqual(appended, ['A careful plan.']);
  assert.equal(calls.find((call) => call[0] === 'transcribe')[1].mimeType, 'audio/webm');
  assert.equal(
    calls.find((call) => call[0] === 'transcribe')[1].audio,
    Buffer.from('audio data').toString('base64'),
  );
  assert.equal(calls.filter((call) => call[0] === 'recording').at(-1)[1], false);
  assert.equal(stopped, 1);
  assert.equal(controller.getState().status, 'idle');
});

test('a context change after stopping prevents sending captured audio to transcription', async () => {
  const calls = [];
  let context = 'campaign-a:hero';
  const controller = new DictationController({
    api: {
      async setRecording() {},
      async cancelTranscription() {},
      async transcribe() {
        calls.push('transcribe');
        return { text: 'stale' };
      },
    },
    mediaDevices: { getUserMedia: async () => streamWith(() => {}) },
    recorderFactory: recorderWith(new Blob(['audio data'])),
    onState() {},
    append() {},
    contextKey: () => context,
  });
  await controller.start();
  await controller.stop();
  context = 'campaign-b:hero';
  await wait();
  assert.deepEqual(calls, []);
  assert.equal(controller.getState().status, 'idle');
});
