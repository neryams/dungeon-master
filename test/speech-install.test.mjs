import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { PHONON_LICENSE_REVISION, SpeechInstaller } from '../dist/desktop/speech-install.js';

async function makeHome() {
  return mkdtemp(path.join(os.tmpdir(), 'dm-speech-install-'));
}

async function waitForPhase(installer, phase) {
  const until = Date.now() + 2_000;
  let state = await installer.status();
  while (state.phase !== phase && Date.now() < until) {
    await new Promise((resolve) => setTimeout(resolve, 5));
    state = await installer.status();
  }
  assert.equal(state.phase, phase);
  return state;
}

async function addReadyAssets(home) {
  for (const file of [
    'venv/bin/python',
    'model/README.md',
    'model/config.json',
    'model/model.q8.gguf',
    'model/tokenizer.json',
    'voices/selected-voices.jsonl',
    'voices/Easton.safetensors',
    'voices/Zoey.safetensors',
  ]) {
    const target = path.join(home, file);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, 'fixture');
  }
  await writeFile(
    path.join(home, 'speech-assets.json'),
    JSON.stringify({
      model_revision: 'cc738b7e4d182c2ba1bafb8062aa4846af000637',
      voice_revision: 'da6c9ec0d47be8df5c87c730a3aa97187f3229c3',
    }),
  );
}

test('preexisting speech assets remain gated until the current license receipt is accepted', async () => {
  const home = await makeHome();
  const sourceRoot = path.join(home, 'source');
  await addReadyAssets(home);
  await mkdir(path.join(sourceRoot, 'licenses', 'phonon'), { recursive: true });
  await writeFile(path.join(sourceRoot, 'licenses', 'phonon', 'NOTICE.md'), 'Notice');
  let downloads = 0;
  const installer = new SpeechInstaller({
    home,
    sourceRoot,
    fetch: async () => {
      downloads += 1;
      throw new Error('must not download when assets already exist');
    },
  });
  try {
    const before = await installer.status();
    assert.equal(before.phase, 'unconfigured');
    assert.equal(before.accepted, false);
    assert.equal(before.licenseRevision, PHONON_LICENSE_REVISION);

    const rejected = await installer.install({ accepted: true, licenseRevision: 'old-license' });
    assert.equal(rejected.phase, 'error');
    assert.equal(rejected.accepted, false);

    const started = await installer.install({
      accepted: true,
      licenseRevision: PHONON_LICENSE_REVISION,
    });
    assert.equal(started.phase, 'installing');
    const ready = await waitForPhase(installer, 'ready');
    assert.equal(ready.phase, 'ready');
    assert.equal(ready.accepted, true);
    assert.equal(downloads, 0);
    assert.equal(await readFile(path.join(home, 'licenses', 'NOTICE.md'), 'utf8'), 'Notice');

    const receipt = JSON.parse(await readFile(path.join(home, 'consent.json'), 'utf8'));
    assert.equal(receipt.licenseRevision, PHONON_LICENSE_REVISION);
    assert.equal('token' in receipt, false);
    assert.equal((await installer.status()).phase, 'ready');
    await writeFile(path.join(home, 'licenses', 'NOTICE.md'), 'cached marker');
    assert.equal((await installer.status()).phase, 'ready');
    assert.equal(await readFile(path.join(home, 'licenses', 'NOTICE.md'), 'utf8'), 'cached marker');

    const declined = await installer.decline();
    assert.equal(declined.phase, 'declined');
    assert.equal(declined.accepted, false);
    await assert.rejects(readFile(path.join(home, 'consent.json')));
    const afterRestart = new SpeechInstaller({ home, sourceRoot });
    try {
      assert.equal((await afterRestart.status()).phase, 'declined');
      assert.equal((await afterRestart.status()).accepted, false);
    } finally {
      afterRestart.close();
    }
  } finally {
    installer.close();
    await rm(home, { recursive: true, force: true });
  }
});

test('installation starts in the background and reports a generic error for an invalid pinned bootstrap', async () => {
  const home = await makeHome();
  let downloadedUrl;
  const installer = new SpeechInstaller({
    home,
    platform: 'darwin',
    arch: 'arm64',
    fetch: async (url) => {
      downloadedUrl = url;
      return new Response('invalid archive', { status: 200 });
    },
  });
  try {
    const started = await installer.install({
      accepted: true,
      licenseRevision: PHONON_LICENSE_REVISION,
      token: 'ephemeral-test-token',
    });
    assert.equal(started.phase, 'installing');
    assert.equal(started.accepted, true);
    assert.equal(started.licenseRevision, PHONON_LICENSE_REVISION);

    const until = Date.now() + 2_000;
    let state = await installer.status();
    while (state.phase === 'installing' && Date.now() < until) {
      await new Promise((resolve) => setTimeout(resolve, 5));
      state = await installer.status();
    }
    assert.equal(state.phase, 'error');
    assert.match(state.detail, /connection and retry/);
    assert.equal(
      downloadedUrl,
      'https://github.com/astral-sh/uv/releases/download/0.13.5/uv-aarch64-apple-darwin.tar.gz',
    );
    const receiptText = await readFile(path.join(home, 'consent.json'), 'utf8');
    assert.equal(receiptText.includes('ephemeral-test-token'), false);
    assert.equal((await installer.status()).accepted, true);
  } finally {
    installer.close();
    await rm(home, { recursive: true, force: true });
  }
});

test('declining narration performs no downloads and keeps gameplay available', async () => {
  const home = await makeHome();
  let downloads = 0;
  const installer = new SpeechInstaller({
    home,
    fetch: async () => {
      downloads += 1;
      throw new Error('unexpected');
    },
  });
  try {
    const declined = await installer.decline();
    assert.equal(declined.phase, 'declined');
    assert.match(declined.detail, /app remains playable/);
    assert.equal(downloads, 0);
    assert.equal((await installer.status()).phase, 'declined');
  } finally {
    installer.close();
    await rm(home, { recursive: true, force: true });
  }
});

test('decline cancels an in-flight bootstrap and persists across a new installer instance', async () => {
  const home = await makeHome();
  let downloads = 0;
  let notifyFetch;
  const fetchStarted = new Promise((resolve) => {
    notifyFetch = resolve;
  });
  const installer = new SpeechInstaller({
    home,
    platform: 'darwin',
    arch: 'arm64',
    fetch: async (_url, options) => {
      downloads += 1;
      notifyFetch();
      return new Promise((_resolve, reject) => {
        options.signal.addEventListener(
          'abort',
          () => reject(new DOMException('aborted', 'AbortError')),
          { once: true },
        );
      });
    },
  });
  try {
    const first = await installer.install({
      accepted: true,
      licenseRevision: PHONON_LICENSE_REVISION,
    });
    const second = await installer.install({
      accepted: true,
      licenseRevision: PHONON_LICENSE_REVISION,
    });
    assert.equal(first.phase, 'installing');
    assert.equal(second.phase, 'installing');
    await fetchStarted;
    assert.equal(downloads, 1);

    const declined = await installer.decline();
    assert.equal(declined.phase, 'declined');
    assert.equal((await installer.status()).phase, 'declined');
    const restarted = new SpeechInstaller({ home });
    try {
      assert.equal((await restarted.status()).phase, 'declined');
      assert.equal((await restarted.status()).accepted, false);
    } finally {
      restarted.close();
    }
  } finally {
    installer.close();
    await rm(home, { recursive: true, force: true });
  }
});

test('immediate decline wins over queued installation and stale status reads', async () => {
  const home = await makeHome();
  let downloads = 0;
  const installer = new SpeechInstaller({
    home,
    fetch: async () => {
      downloads += 1;
      throw new Error('declined installation must not download');
    },
  });
  try {
    const staleStatus = installer.status();
    const installation = installer.install({
      accepted: true,
      licenseRevision: PHONON_LICENSE_REVISION,
    });
    assert.equal((await staleStatus).phase, 'installing');
    const declined = installer.decline();
    assert.equal((await declined).phase, 'declined');
    await installation;
    assert.equal((await installer.status()).phase, 'declined');
    assert.equal(downloads, 0);

    const reopened = new SpeechInstaller({ home });
    try {
      const statusBeforeDeclineSettles = reopened.status();
      const declineAgain = reopened.decline();
      assert.equal((await statusBeforeDeclineSettles).phase, 'declined');
      await declineAgain;
      assert.equal((await reopened.status()).phase, 'declined');
    } finally {
      reopened.close();
    }
  } finally {
    installer.close();
    await rm(home, { recursive: true, force: true });
  }
});

test('declining from a fresh cache persists before any install directory exists', async () => {
  const parent = await makeHome();
  const home = path.join(parent, 'speech-home');
  const installer = new SpeechInstaller({ home });
  try {
    await assert.rejects(readFile(home), { code: 'ENOENT' });
    const declined = await installer.decline();
    assert.equal(declined.phase, 'declined');
    const reopened = new SpeechInstaller({ home });
    try {
      const state = await reopened.status();
      assert.equal(state.phase, 'declined');
      assert.equal(state.accepted, false);
    } finally {
      reopened.close();
    }
  } finally {
    installer.close();
    await rm(parent, { recursive: true, force: true });
  }
});
