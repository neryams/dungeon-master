import test from 'node:test';
import assert from 'node:assert/strict';
import { _electron } from 'playwright-core';
import electron from 'electron';
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fixture } from './helpers.mjs';

test(
  'speech setup asks for explicit license acceptance and can be skipped without blocking play',
  { timeout: 60000 },
  async (t) => {
    const { store } = await fixture(t);
    const artifacts = await mkdtemp(join(tmpdir(), 'dm-speech-install-ui-'));
    const env = {
      ...process.env,
      DM_DESKTOP_NODE: process.execPath,
      DM_DESKTOP_USER_DATA: join(artifacts, 'profile'),
      DM_SPEECH_HOME: join(artifacts, 'speech-home'),
    };
    delete env.ELECTRON_RUN_AS_NODE;
    let app;
    t.after(async () => {
      await app?.close();
      await rm(artifacts, { recursive: true, force: true });
    });
    app = await _electron.launch({
      executablePath: electron,
      args: [
        ...(process.platform === 'linux' ? ['--ozone-platform=x11'] : []),
        resolve('build/desktop/main.mjs'),
      ],
      env,
      timeout: 20000,
    });
    const page = await app.firstWindow();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.waitForSelector('#create-form');
    await page.locator('#speech-dialog').waitFor({ state: 'visible' });
    await page.screenshot({ path: '/tmp/dm-speech-install-dialog.png' });
    const consentLayout = await page.locator('#speech-dialog').evaluate((dialog) => {
      const checkbox = dialog.querySelector('#speech-consent').getBoundingClientRect();
      const text = dialog.querySelector('.speech-consent span').getBoundingClientRect();
      return {
        checkboxWidth: checkbox.width,
        textLeft: text.left,
        textRight: text.right,
        dialogLeft: dialog.getBoundingClientRect().left,
        dialogRight: dialog.getBoundingClientRect().right,
        scrollWidth: dialog.scrollWidth,
        clientWidth: dialog.clientWidth,
      };
    });
    assert.ok(consentLayout.checkboxWidth <= 24, 'the consent checkbox keeps its native size');
    assert.ok(consentLayout.textLeft > consentLayout.dialogLeft);
    assert.ok(consentLayout.textRight < consentLayout.dialogRight);
    assert.ok(consentLayout.scrollWidth <= consentLayout.clientWidth + 2);
    assert.equal(await page.locator('#speech-consent').isChecked(), false);
    assert.equal(await page.locator('#speech-install').isDisabled(), true);
    assert.match(await page.locator('#speech-dialog').innerText(), /noncommercial/i);
    assert.match(await page.locator('#speech-dialog').innerText(), /attribution/i);
    await page.locator('#speech-consent').check();
    assert.equal(await page.locator('#speech-install').isDisabled(), false);
    await page.locator('#speech-token').fill('hf_test_one_time_token');
    await page.locator('#speech-close').click();
    await page.waitForFunction(
      async () => (await window.table.speechSetupStatus()).phase === 'declined',
    );
    await page.locator('#speech-dialog').waitFor({ state: 'hidden' });
    assert.equal(await page.locator('#speech-dialog').isHidden(), true);
    assert.equal(await page.locator('#speech-consent').isChecked(), false);
    assert.equal(await page.locator('#speech-settings').isVisible(), true);
    assert.equal(await page.locator('#speech-token').inputValue(), '');
    assert.equal(
      await page.evaluate(() => JSON.stringify(Object.keys(localStorage))),
      '[]',
      'a token entered in the one-time setup field is not persisted in local storage',
    );

    await page.evaluate(async (root) => {
      const { showCampaign } = await import('./app.js');
      showCampaign(await window.table.open(root));
    }, store.root);
    await page.locator('#play').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#speech-dialog').isHidden(), true);
    await page.locator('#speech-settings').click();
    await page.locator('#speech-dialog').waitFor({ state: 'visible' });
    assert.match(await page.locator('#speech-status').innerText(), /off|play normally/i);
    await page.reload();
    await page.waitForSelector('#create-form');
    await page.waitForFunction(
      async () => (await window.table.speechSetupStatus()).phase === 'declined',
    );
    assert.equal(await page.locator('#speech-dialog').isHidden(), true);
    assert.deepEqual(errors, []);
  },
);

test(
  'bundled narration consent enables local narration without token or download setup',
  { timeout: 60000 },
  async (t) => {
    const { store } = await fixture(t);
    const artifacts = await mkdtemp(join(tmpdir(), 'dm-speech-bundled-ui-'));
    const bundle = join(artifacts, 'speech');
    for (const file of [
      'bin/ptts',
      'model/config.json',
      'model/tokenizer.json',
      'model/model.q8.gguf',
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
      const target = join(bundle, file);
      await mkdir(join(target, '..'), { recursive: true });
      await writeFile(target, 'isolated ui fixture');
    }
    await chmod(join(bundle, 'bin/ptts'), 0o755);
    await writeFile(
      join(bundle, 'speech-assets.json'),
      JSON.stringify({
        phonon_cli_version: '0.4.0',
        model_repo: 'gradium/phonon-40m-en',
        model_revision: 'cc738b7e4d182c2ba1bafb8062aa4846af000637',
        voice_repo: 'gradium/phonon-voices',
        voice_revision: 'da6c9ec0d47be8df5c87c730a3aa97187f3229c3',
        platform: `${process.platform}-${process.arch}`,
        runtime_archive: 'ptts-0.4.0-aarch64-apple-darwin.tar.gz',
        runtime_archive_sha256: '7b26c8b9d98f5b5894de09af2aad35e64827e8475c07b003557cafc1ebba6a40',
      }),
    );
    const env = {
      ...process.env,
      DM_DESKTOP_NODE: process.execPath,
      DM_DESKTOP_USER_DATA: join(artifacts, 'profile'),
      DM_SPEECH_HOME: join(artifacts, 'speech-home'),
      DM_BUNDLED_SPEECH: bundle,
    };
    delete env.ELECTRON_RUN_AS_NODE;
    let app;
    t.after(async () => {
      await app?.close();
      await rm(artifacts, { recursive: true, force: true });
    });
    app = await _electron.launch({
      executablePath: electron,
      args: [
        ...(process.platform === 'linux' ? ['--ozone-platform=x11'] : []),
        resolve('build/desktop/main.mjs'),
      ],
      env,
      timeout: 20000,
    });
    const page = await app.firstWindow();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.waitForSelector('#create-form');
    await page.locator('#speech-dialog').waitFor({ state: 'visible' });
    await page.screenshot({ path: '/tmp/dm-speech-bundled-dialog.png' });
    assert.equal(await page.locator('#speech-token-label').isHidden(), true);
    assert.equal(await page.locator('#speech-access-link').isHidden(), true);
    assert.equal(await page.locator('#speech-token-link').isHidden(), true);
    assert.doesNotMatch(
      await page.locator('#speech-dialog').innerText(),
      /Hugging Face|download|installing/i,
    );
    assert.match(await page.locator('#speech-dialog').innerText(), /noncommercial/i);
    assert.equal(await page.locator('#speech-install').textContent(), 'Agree & enable narration');
    await page.locator('#speech-consent').check();
    await page.locator('#speech-install').click();
    await page.waitForFunction(
      async () => (await window.table.speechSetupStatus()).phase === 'ready',
    );
    assert.match(await page.locator('#speech-status').innerText(), /ready/i);
    assert.equal(await page.locator('#speech-token-label').isHidden(), true);
    assert.deepEqual(errors, []);
  },
);
