import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { SpeechRuntime } from '../dist/desktop/speech-runtime.js';

const FAKE_SIDECAR = String.raw`
import fs from 'node:fs';
import readline from 'node:readline';
fs.appendFileSync('starts.log', 'start\n');
fs.writeFileSync('environment.json', JSON.stringify({token: process.env.HF_TOKEN, offline: process.env.HF_HUB_OFFLINE, home: process.env.HOME}));
setTimeout(() => process.stdout.write(JSON.stringify({type:'ready'}) + '\n'), 75);
readline.createInterface({input:process.stdin}).on('line', line => {
  const request = JSON.parse(line);
  fs.appendFileSync('requests.log', request.text + '\n');
  if (request.text === 'hang') return;
  if (request.text === 'null-response') return process.stdout.write('null\n');
  if (request.text === 'overflow') return process.stdout.write('x'.repeat(15 * 1024 * 1024));
  process.stdout.write(JSON.stringify({id:request.id,ok:true,audio:Buffer.from('RIFF').toString('base64')}) + '\n');
});
`;

async function makeRuntime(options = {}) {
  const home = await mkdtemp(path.join(os.tmpdir(), 'dm-speech-test-'));
  await mkdir(path.join(home, 'venv', 'bin'), { recursive: true });
  await mkdir(path.join(home, 'model'), { recursive: true });
  await mkdir(path.join(home, 'voices'), { recursive: true });
  for (const file of [
    'venv/bin/python',
    'model/config.json',
    'model/model.q8.gguf',
    'model/tokenizer.json',
    'voices/selected-voices.jsonl',
    'voices/Easton.safetensors',
    'voices/Zoey.safetensors',
  ]) {
    await writeFile(path.join(home, file), 'fixture');
  }
  const scriptPath = path.join(home, 'fake-sidecar.mjs');
  await writeFile(scriptPath, FAKE_SIDECAR);
  return {
    home,
    runtime: new SpeechRuntime({
      home,
      pythonPath: process.execPath,
      scriptPath,
      startupTimeoutMs: 3_000,
      synthesisTimeoutMs: 3_000,
      ...options,
    }),
  };
}

async function waitFor(check) {
  const until = Date.now() + 5_000;
  while (Date.now() < until) {
    try {
      if (await check()) return;
    } catch {
      // The sidecar may not have created its observation file yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('Timed out waiting for sidecar fixture.');
}

test('speech runtime reports missing assets and validates bounded requests', async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), 'dm-speech-test-'));
  const runtime = new SpeechRuntime({
    home,
    pythonPath: process.execPath,
    scriptPath: path.join(home, 'missing.mjs'),
  });
  try {
    assert.deepEqual(await runtime.status(), {
      available: false,
      detail: 'Narration is not installed on this computer. See the desktop setup guide.',
    });
    await assert.rejects(runtime.synthesize('  ', 'Easton'), /1–2000 characters/);
    await assert.rejects(runtime.synthesize('x'.repeat(2_001), 'Easton'), /1–2000 characters/);
    await assert.rejects(runtime.synthesize('hello', 'Unknown'), /Unsupported speech voice/);
  } finally {
    runtime.close();
    await rm(home, { recursive: true, force: true });
  }
});

test('speech runtime replaces cancelled startup immediately and bounds malformed sidecar output', async () => {
  const { home, runtime } = await makeRuntime();
  const hadToken = Object.hasOwn(process.env, 'HF_TOKEN');
  const previousToken = process.env.HF_TOKEN;
  process.env.HF_TOKEN = 'should-not-be-inherited';
  try {
    assert.equal((await runtime.status()).available, true);
    const cancelledDuringStart = runtime.synthesize('cancel while starting', 'Easton');
    await waitFor(async () => (await readFile(path.join(home, 'starts.log'), 'utf8')).length > 0);
    runtime.cancel();
    const replacementDuringStart = runtime.synthesize('replacement starts now', 'Easton');
    await assert.rejects(cancelledDuringStart, /cancelled/);
    assert.equal(await replacementDuringStart, Buffer.from('RIFF').toString('base64'));

    const observedEnv = JSON.parse(await readFile(path.join(home, 'environment.json'), 'utf8'));
    assert.equal(observedEnv.token, undefined);
    assert.equal(observedEnv.offline, '1');
    assert.equal(observedEnv.home, home);

    const cancelled = runtime.synthesize('hang', 'Zoey');
    await waitFor(async () =>
      (await readFile(path.join(home, 'requests.log'), 'utf8')).includes('hang'),
    );
    runtime.cancel();
    await assert.rejects(cancelled, /cancelled/);
    assert.equal(
      await runtime.synthesize('after cancellation', 'Zoey'),
      Buffer.from('RIFF').toString('base64'),
    );
    assert.equal(
      await runtime.synthesize('reuse child', 'Easton'),
      Buffer.from('RIFF').toString('base64'),
    );

    await assert.rejects(runtime.synthesize('null-response', 'Easton'), /invalid response/);
    assert.equal(
      await runtime.synthesize('after malformed response', 'Easton'),
      Buffer.from('RIFF').toString('base64'),
    );
    await assert.rejects(runtime.synthesize('overflow', 'Easton'), /oversized audio/);
    assert.equal(
      await runtime.synthesize('after oversized response', 'Easton'),
      Buffer.from('RIFF').toString('base64'),
    );
    const starts = (await readFile(path.join(home, 'starts.log'), 'utf8')).trim().split('\n');
    assert.ok(
      starts.length >= 4,
      'cancelled or malformed requests must be served by a restarted owned child',
    );
  } finally {
    if (hadToken) process.env.HF_TOKEN = previousToken;
    else delete process.env.HF_TOKEN;
    runtime.close();
    await rm(home, { recursive: true, force: true });
  }
});

test('cancel invalidates a request awaiting asset checks without spawning it, then accepts replacement', async () => {
  let releaseAssets;
  let accessStarted;
  const started = new Promise((resolve) => {
    accessStarted = resolve;
  });
  const waitForAssets = new Promise((resolve) => {
    releaseAssets = resolve;
  });
  const assetAccess = async () => {
    accessStarted();
    await waitForAssets;
  };
  const { home, runtime } = await makeRuntime({ assetAccess });
  try {
    const cancelled = runtime.synthesize('must not dispatch', 'Easton');
    await started;
    runtime.cancel();
    const replacement = runtime.synthesize('replacement after delayed check', 'Zoey');
    releaseAssets();
    await assert.rejects(cancelled, /cancelled/);
    assert.equal(await replacement, Buffer.from('RIFF').toString('base64'));
    const starts = (await readFile(path.join(home, 'starts.log'), 'utf8')).trim().split('\n');
    assert.equal(starts.length, 1);
    assert.equal(
      (await readFile(path.join(home, 'requests.log'), 'utf8')).includes('must not dispatch'),
      false,
    );
  } finally {
    runtime.close();
    await rm(home, { recursive: true, force: true });
  }
});
