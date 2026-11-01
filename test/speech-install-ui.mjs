import test from 'node:test';
import assert from 'node:assert/strict';
import { _electron } from 'playwright-core';
import electron from 'electron';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fixture } from './helpers.mjs';

test(
  'speech settings disclose cloud use, keep the key field blank, and allow narration to be skipped',
  { timeout: 60000 },
  async (t) => {
    const { store } = await fixture(t);
    const artifacts = await mkdtemp(join(tmpdir(), 'dm-speech-settings-ui-'));
    const env = {
      ...process.env,
      DM_DESKTOP_NODE: process.execPath,
      DM_DESKTOP_USER_DATA: join(artifacts, 'profile'),
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
    const content = await page.locator('#speech-dialog').innerText();
    assert.match(content, /Google AI Studio API key/i);
    assert.match(content, /Audio and text are sent to Google/i);
    assert.match(content, /billing may apply/i);
    assert.equal(await page.locator('#speech-voice option').count(), 30);
    assert.equal(await page.locator('#speech-voice').inputValue(), 'Kore');
    assert.equal(await page.locator('#speech-autoplay').isChecked(), false);
    await page.locator('#speech-key').fill('temporary-ui-key');
    await page.locator('#speech-skip').click();
    await page.locator('#speech-dialog').waitFor({ state: 'hidden' });
    assert.equal(await page.locator('#speech-key').inputValue(), '');
    assert.equal(await page.locator('#speech-settings').isVisible(), true);
    await page.evaluate(async (root) => {
      const { showCampaign } = await import('./app.js');
      showCampaign(await window.table.open(root));
    }, store.root);
    await page.locator('#play').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#dictation').isVisible(), true);
    assert.equal(
      await page.locator('#dictation').isDisabled(),
      true,
      'dictation remains unavailable until a key is configured',
    );
    assert.deepEqual(errors, []);
  },
);
