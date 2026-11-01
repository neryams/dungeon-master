import test from 'node:test';
import assert from 'node:assert/strict';
import { _electron } from 'playwright-core';
import electron from 'electron';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fixture } from './helpers.mjs';

test(
  'narration controls migrate legacy voice and mute preferences without requiring a key',
  { timeout: 60000 },
  async (t) => {
    const { store } = await fixture(t);
    const artifacts = await mkdtemp(join(tmpdir(), 'dm-narration-ui-'));
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
    await page.addInitScript(() =>
      localStorage.setItem(
        'dungeon-master.narration.v1',
        JSON.stringify({ enabled: false, voice: 'Zoey' }),
      ),
    );
    await page.reload();
    await page.waitForSelector('#create-form');
    await page.locator('#speech-dialog').waitFor({ state: 'visible' });
    await page.locator('#speech-skip').click();
    await page.evaluate(async (root) => {
      const { showCampaign } = await import('./app.js');
      showCampaign(await window.table.open(root));
    }, store.root);
    await page.locator('#narration-controls').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#narration-mute').innerText(), 'Enable narration');
    assert.equal(await page.locator('#speech-settings').isVisible(), true);
    assert.equal(await page.locator('.message-read').count(), 0);
    await page.locator('#speech-settings').click();
    assert.equal(await page.locator('#speech-voice').inputValue(), 'Kore');
    await page.locator('#speech-voice').selectOption('Aoede');
    await page.locator('#speech-skip').click();
    await page.waitForFunction(
      () => JSON.parse(localStorage.getItem('dungeon-master.narration.v2')).voice === 'Aoede',
    );
    await page.reload();
    await page.waitForSelector('#create-form');
    await page.evaluate(async (root) => {
      const { showCampaign } = await import('./app.js');
      showCampaign(await window.table.open(root));
    }, store.root);
    await page.locator('#narration-controls').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#narration-mute').innerText(), 'Enable narration');
    assert.deepEqual(errors, []);
  },
);
