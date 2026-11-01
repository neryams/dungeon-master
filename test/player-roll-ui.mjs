import test from 'node:test';
import assert from 'node:assert/strict';
import { _electron } from 'playwright-core';
import electron from 'electron';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fixture, apply, hero } from './helpers.mjs';
import { requestPlayerRoll } from '../dist/desktop/player-roll.js';
import { randomUUID } from 'node:crypto';

test(
  'Electron accepts raw physical faces during resolution and retains public cards',
  { timeout: 30000 },
  async (t) => {
    const artifacts = await mkdtemp(join(tmpdir(), 'dm-player-roll-ui-'));
    const { store, service } = await fixture(t);
    await apply(service, [
      { type: 'put_entity', entity: hero },
      { type: 'set_party', members: ['hero'] },
    ]);
    await requestPlayerRoll(store, {
      operationId: randomUUID(),
      expectedRevision: (await store.read()).state.revision,
      reason: 'Test',
      characterId: 'hero',
      expression: '1d20+3',
      mode: 'advantage',
      purpose: 'Dexterity save',
    });
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
      args: [resolve('build/desktop/main.mjs')],
      env,
      timeout: 20000,
    });
    const page = await app.firstWindow();
    await page.waitForSelector('#create-form');
    await page.evaluate(async (root) => {
      const snapshot = await window.table.open(root);
      const { showCampaign } = await import('./app.js');
      showCampaign({ ...snapshot, stage: 'resolving' });
    }, store.root);
    assert.equal(await page.locator('#roll-prompt').isVisible(), true);
    assert.equal(await page.locator('#roll-inputs input').count(), 2);
    assert.equal(await page.locator('#roll-submit').isEnabled(), true);
    await page.locator('#roll-inputs input').nth(0).fill('4');
    await page.locator('#roll-inputs input').nth(1).fill('21');
    await page.locator('#roll-submit').click();
    assert.equal(await page.locator('#roll-error').isVisible(), true);
    await page.locator('#roll-inputs input').nth(1).fill('17');
    if (process.env.DM_ROLL_SCREENSHOT)
      await page.screenshot({ path: process.env.DM_ROLL_SCREENSHOT });
    // Ordinary snapshot refresh should preserve typed raw faces.
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    assert.deepEqual(
      await page.locator('#roll-inputs input').evaluateAll((nodes) => nodes.map((n) => n.value)),
      ['4', '17'],
    );
    await page.locator('#roll-submit').click();
    await page.waitForFunction(() => document.querySelector('#roll-prompt').hidden);
    assert.match(await page.locator('.roll-card').textContent(), /Faces: 4, 17/);
    assert.match(await page.locator('.roll-card').textContent(), /Total: 20/);
    assert.match(await page.locator('.roll-card').textContent(), /Physical dice/);
    const saved = (await store.read()).events.filter((e) => e.payload.roll).at(-1).payload.roll;
    assert.deepEqual(saved.dice, [4, 17]);
    assert.equal(saved.total, 20);
    await page.evaluate(async () => {
      const { showCampaign } = await import('./app.js');
      showCampaign(await window.table.snapshot());
    });
    assert.equal(await page.locator('.roll-card').count(), 1);
    await requestPlayerRoll(store, {
      operationId: randomUUID(),
      expectedRevision: (await store.read()).state.revision,
      reason: 'Digital test',
      characterId: 'hero',
      expression: '1d20',
      purpose: 'Perception check',
    });
    await page.evaluate(async () => {
      const { showCampaign } = await import('./app.js');
      showCampaign(await window.table.snapshot());
    });
    assert.equal(await page.locator('#roll-submit').textContent(), 'Roll dice');
    await page.locator('#roll-submit').click();
    await page.waitForFunction(() => document.querySelectorAll('.roll-card').length === 2);
    assert.equal(
      (await store.read()).events.filter((e) => e.payload.roll).at(-1).payload.roll.source,
      'digital',
    );
  },
);
