import test from 'node:test';
import assert from 'node:assert/strict';
import electron from 'electron';
import { _electron } from 'playwright-core';
import { createServer } from 'node:http';
import { mkdtemp, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fixture, apply } from './helpers.mjs';

const SYNTHETIC_KEY = 'AQ.SyntheticLocalSpeechKey_0123456789';

async function launch(userData, extraArgs = []) {
  const executablePath = process.env.DM_TEST_DESKTOP_EXECUTABLE ?? electron;
  const entrypoint = process.env.DM_TEST_DESKTOP_EXECUTABLE
    ? []
    : [resolve('build/desktop/main.mjs')];
  const env = { ...process.env, DM_DESKTOP_NODE: process.execPath, DM_DESKTOP_USER_DATA: userData };
  for (const name of [
    'ELECTRON_RUN_AS_NODE',
    'GOOGLE_API_KEY',
    'GEMINI_API_KEY',
    'GOOGLE_GENAI_API_KEY',
  ])
    delete env[name];
  return _electron.launch({
    executablePath,
    args: [
      ...(process.platform === 'linux' ? ['--ozone-platform=x11'] : []),
      '--use-fake-device-for-media-stream',
      ...extraArgs,
      ...entrypoint,
    ],
    env,
    timeout: 20000,
  });
}

async function configureSecureStorageForTest(app) {
  return app.evaluate(async ({ safeStorage }) => {
    const available = await safeStorage.isAsyncEncryptionAvailable();
    const backend = safeStorage.getSelectedStorageBackend?.();
    if (available && (process.platform !== 'linux' || !['basic_text', 'unknown'].includes(backend)))
      return { fallback: false, backend };
    // Linux CI may lack a keyring. The test key is synthetic; use deterministic test-only wrapping.
    safeStorage.isAsyncEncryptionAvailable = async () => true;
    safeStorage.getSelectedStorageBackend = () => 'gnome_libsecret';
    safeStorage.encryptStringAsync = async (value) => Buffer.from(`test-wrap:${value}`);
    safeStorage.decryptStringAsync = async (value) => ({
      result: Buffer.from(value)
        .toString()
        .replace(/^test-wrap:/, ''),
    });
    return { fallback: true, backend };
  });
}

test(
  'Electron main speech credentials and local player bridge stay isolated',
  { timeout: 60000 },
  async (t) => {
    const artifacts = await mkdtemp(join(tmpdir(), 'dm-speech-main-ui-'));
    const userData = join(artifacts, 'profile');
    const { store, service } = await fixture(t);
    const example = JSON.parse(await readFile('examples/lantern-ford.json', 'utf8'));
    await apply(service, example.changes);
    await service.execute('create_location_map', {
      operationId: 'speech-main-ui-map',
      expectedRevision: 1,
      reason: 'Speech integration fixture',
      entity: example.bridgeMap,
    });
    t.after(async () => {
      await (await import('node:fs/promises')).rm(artifacts, { recursive: true, force: true });
    });

    let app = await launch(userData);
    t.after(async () => {
      await app?.close();
    });
    let page = await app.firstWindow();
    await page.waitForSelector('#create-form');
    const storageMode = await configureSecureStorageForTest(app);
    await page.locator('#speech-dialog[open]').waitFor();
    await page.locator('#speech-key').fill(SYNTHETIC_KEY);
    await page.locator('#speech-save').click();
    await page.waitForFunction(() =>
      document.querySelector('#speech-key-state').textContent.startsWith('An API key is saved'),
    );
    assert.equal(
      await page.locator('#speech-key').inputValue(),
      '',
      'key input is cleared after save',
    );

    const credentialPath = join(userData, 'gemini-credentials.bin');
    const encrypted = await readFile(credentialPath);
    assert.ok(encrypted.length > 0);
    assert.equal(
      encrypted.includes(Buffer.from(SYNTHETIC_KEY)),
      false,
      'credential file does not contain plaintext key',
    );
    assert.equal((await stat(credentialPath)).mode & 0o777, 0o600);

    await page.locator('#speech-skip').click();
    const invalidSpeech = await page.evaluate(async () => {
      try {
        await window.table.speech({});
        return 'accepted';
      } catch (error) {
        return error.message;
      }
    });
    assert.notEqual(invalidSpeech, 'accepted');
    assert.equal(
      await page.evaluate(() => typeof window.table.speechText),
      'undefined',
      'worker text lookup is not exposed to renderer',
    );

    await app.close();
    app = await launch(userData);
    page = await app.firstWindow();
    await page.waitForSelector('#create-form');
    await configureSecureStorageForTest(app);
    await page.locator('#speech-settings').click();
    await page.locator('#speech-dialog[open]').waitFor();
    assert.match(await page.locator('#speech-key-state').innerText(), /key is saved/i);
    assert.equal(
      await page.locator('#speech-key').inputValue(),
      '',
      'saved key is never restored into the input',
    );
    await page.locator('#speech-remove').click();
    await page.waitForFunction(() =>
      document.querySelector('#speech-key-state').textContent.includes('No API key'),
    );
    await assert.rejects(readFile(credentialPath), { code: 'ENOENT' });

    await page.locator('#speech-skip').click();
    await page.evaluate((root) => window.table.open(root), store.root);
    const lan = await page.evaluate(() => window.table.startLan());
    const localLink = lan.urls.find((url) => url.startsWith('http://127.0.0.1:'));
    assert.ok(localLink, 'test campaign has a local loopback invitation');
    await page.evaluate((link) => window.table.joinLan(link), localLink);
    const player = app.windows().find((candidate) => candidate !== page);
    assert.ok(player);
    await player.waitForFunction(() => window.speechInput !== undefined);
    assert.equal(await player.evaluate(() => typeof window.speechInput), 'object');
    assert.equal(
      (await player.evaluate(() => window.speechInput.speechSettings())).configured,
      false,
    );
    const invalidTranscription = await player.evaluate(async () => {
      try {
        await window.speechInput.transcribe({ audio: '!!!!', mimeType: 'audio/webm' });
        return 'accepted';
      } catch (error) {
        return error.message;
      }
    });
    assert.match(invalidTranscription, /invalid or too large/i);

    const iframeApi = await player.evaluate(async () => {
      const iframe = document.createElement('iframe');
      iframe.srcdoc =
        '<!doctype html><script>document.body.dataset.bridge = String(typeof window.speechInput)<\\/script>';
      document.body.append(iframe);
      await new Promise((resolve) => iframe.addEventListener('load', resolve, { once: true }));
      return iframe.contentWindow.speechInput;
    });
    assert.equal(iframeApi, undefined, 'subframes do not receive the privileged speech bridge');

    const remote = createServer((_request, response) => {
      response.setHeader('content-type', 'text/html');
      response.end('<!doctype html><html><body>remote client</body></html>');
    });
    await new Promise((resolve) => remote.listen(0, '127.0.0.1', resolve));
    t.after(() => new Promise((resolve) => remote.close(resolve)));
    const remotePort = remote.address().port;
    await page.evaluate(
      (link) => window.table.joinLan(link),
      `http://127.0.0.1:${remotePort}/#${'a'.repeat(64)}`,
    );
    const remoteWindow = app
      .windows()
      .find((candidate) => candidate !== page && candidate !== player);
    assert.ok(remoteWindow);
    await remoteWindow.waitForLoadState('domcontentloaded');
    assert.equal(
      await remoteWindow.evaluate(() => typeof window.speechInput),
      'undefined',
      'a non-session remote origin has no speech bridge',
    );

    const mediaResult = await player.evaluate(async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        stream.getTracks().forEach((track) => track.stop());
        return 'granted';
      } catch (error) {
        return error.name;
      }
    });
    assert.equal(
      mediaResult,
      'granted',
      `local loopback host recording should use the fake audio device (storage fallback: ${storageMode.fallback})`,
    );
    const mainAudio = await page.evaluate(async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        stream.getTracks().forEach((track) => track.stop());
        return 'granted';
      } catch (error) {
        return error.name;
      }
    });
    assert.equal(mainAudio, 'granted', 'trusted desktop frame can request fake audio');
    const cameraResult = await page.evaluate(async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true });
        stream.getTracks().forEach((track) => track.stop());
        return 'granted';
      } catch (error) {
        return error.name;
      }
    });
    assert.notEqual(cameraResult, 'granted', 'video permission is denied');
    const remoteAudio = await remoteWindow.evaluate(async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        stream.getTracks().forEach((track) => track.stop());
        return 'granted';
      } catch (error) {
        return error.name;
      }
    });
    assert.notEqual(remoteAudio, 'granted', 'non-session origin cannot request microphone access');
  },
);
