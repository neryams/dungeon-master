import assert from 'node:assert/strict';
import { chmod, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
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

test('bundled native runtime uses only local assets and bounds cancellable CLI inference', async () => {
  const bundle = await mkdtemp(path.join(os.tmpdir(), 'dm-bundled-speech-test-'));
  const home = await mkdtemp(path.join(os.tmpdir(), 'dm-bundled-speech-home-'));
  const hadBundle = Object.hasOwn(process.env, 'DM_BUNDLED_SPEECH');
  const previousBundle = process.env.DM_BUNDLED_SPEECH;
  const hadToken = Object.hasOwn(process.env, 'HF_TOKEN');
  const previousToken = process.env.HF_TOKEN;
  await mkdir(path.join(bundle, 'bin'), { recursive: true });
  await mkdir(path.join(bundle, 'model'), { recursive: true });
  await mkdir(path.join(bundle, 'voices'), { recursive: true });
  for (const file of [
    'model/config.json',
    'model/model.q8.gguf',
    'model/tokenizer.json',
    'model/default-voice.safetensors',
    'model/README.md',
    'voices/Easton.safetensors',
    'voices/Zoey.safetensors',
    'licenses/CC-BY-NC-4.0.txt',
    'licenses/NOTICE.md',
    'licenses/Apache-2.0.txt',
    'licenses/PTTS-MIT.txt',
    'licenses/PTTS-APACHE-2.0.txt',
  ]) {
    await mkdir(path.dirname(path.join(bundle, file)), { recursive: true });
    await writeFile(path.join(bundle, file), 'fixture');
  }
  await writeFile(
    path.join(bundle, 'speech-assets.json'),
    JSON.stringify({
      model_repo: 'gradium/phonon-40m-en',
      voice_repo: 'gradium/phonon-voices',
      model_revision: 'cc738b7e4d182c2ba1bafb8062aa4846af000637',
      voice_revision: 'da6c9ec0d47be8df5c87c730a3aa97187f3229c3',
      phonon_cli_version: '0.4.0',
      platform: 'darwin-arm64',
      runtime_archive_sha256: '7b26c8b9d98f5b5894de09af2aad35e64827e8475c07b003557cafc1ebba6a40',
    }),
  );
  const fake = path.join(bundle, 'bin', 'ptts');
  await writeFile(
    fake,
    String.raw`#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
if (args.at(-1) === 'hang') { setTimeout(() => {}, 10_000); }
else {
  const output = args[args.indexOf('--output') + 1];
  const wav = Buffer.alloc(48);
  wav.write('RIFF', 0); wav.write('WAVE', 8);
  fs.writeFileSync(output, wav);
}
`,
  );
  await chmod(fake, 0o755);
  process.env.DM_BUNDLED_SPEECH = bundle;
  process.env.HF_TOKEN = 'must-not-be-inherited';
  const seen = [];
  const runtime = new SpeechRuntime({
    home,
    synthesisTimeoutMs: 3_000,
    spawn: (command, args, options) => {
      seen.push({ command, args, env: options.env });
      return spawn(command, args, options);
    },
  });
  try {
    assert.equal((await runtime.status()).available, true);
    const audio = await runtime.synthesize('offline only', 'Zoey');
    assert.equal(Buffer.from(audio, 'base64').toString('ascii', 0, 4), 'RIFF');
    assert.equal(seen.length, 1);
    assert.equal(seen[0].command, path.join(bundle, 'bin', 'ptts'));
    assert.ok(seen[0].args.includes(path.join(bundle, 'model')));
    assert.ok(seen[0].args.includes(path.join(bundle, 'voices', 'Zoey.safetensors')));
    assert.equal(seen[0].args.at(-2), '--');
    assert.equal(seen[0].args.at(-1), 'offline only');
    assert.equal(seen[0].env.HF_TOKEN, undefined);
    assert.equal(seen[0].env.HF_HUB_OFFLINE, '1');
    const cancelled = runtime.synthesize('hang', 'Easton');
    await new Promise((resolve) => setTimeout(resolve, 50));
    runtime.cancel();
    await assert.rejects(cancelled, /cancelled/);
  } finally {
    runtime.close();
    if (hadBundle) process.env.DM_BUNDLED_SPEECH = previousBundle;
    else delete process.env.DM_BUNDLED_SPEECH;
    if (hadToken) process.env.HF_TOKEN = previousToken;
    else delete process.env.HF_TOKEN;
    await Promise.all([
      rm(bundle, { recursive: true, force: true }),
      rm(home, { recursive: true, force: true }),
    ]);
  }
});
