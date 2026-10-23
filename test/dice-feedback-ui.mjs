import test from 'node:test';
import assert from 'node:assert/strict';
import { _electron } from 'playwright-core';
import electron from 'electron';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fixture } from './helpers.mjs';

test(
  'Electron dice feedback uses saved totals, queues, avoids replay and cleans up',
  { timeout: 30000 },
  async (t) => {
    const artifacts = await mkdtemp(join(tmpdir(), 'dm-dice-ui-'));
    const { store } = await fixture(t);
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
    await page.waitForSelector('#create-form');
    await page.evaluate((root) => {
      window.__fixtureRoot = root;
    }, store.root);
    await page.evaluate(async () => {
      const { DiceFeedback } = await import('./dice-feedback.js');
      const get = (id) => document.getElementById(`dice-${id}`);
      const panel = document.getElementById('dice-feedback');
      const feedback = new DiceFeedback(
        {
          panel,
          label: get('label'),
          notation: get('notation'),
          total: get('total'),
          breakdown: get('breakdown'),
          announcement: get('announcement'),
          dismiss: get('dismiss'),
        },
        () => window.__reduceMotion,
      );
      window.__diceFeedback = feedback;
      window.__dicePanel = panel;
      window.__reduceMotion = false;
      const snapshot = await window.table.open(window.__fixtureRoot);
      const { showCampaign } = await import('./app.js');
      showCampaign({
        ...snapshot,
        stage: 'resolving',
        activity: {
          phase: 'Resolving an attack',
          rolls: [
            {
              id: 'old',
              label: 'Old roll',
              notation: '1d20',
              status: 'complete',
              total: 9,
              dice: [9],
            },
          ],
        },
      });
      window.__diceFeedback.reset([
        { id: 'old', label: 'Old roll', notation: '1d20', status: 'complete', total: 9, dice: [9] },
      ]);
      window.__diceFeedback.observe(
        [
          {
            id: 'old',
            label: 'Old roll',
            notation: '1d20',
            status: 'complete',
            total: 9,
            dice: [9],
          },
        ],
        true,
      );
    });
    assert.equal(
      await page.locator('#dice-feedback').isHidden(),
      true,
      'opening baseline rolls do not replay',
    );
    assert.equal(await page.locator('#active-turn').isVisible(), true);
    assert.equal(await page.locator('#active-turn-phase').textContent(), 'Resolving an attack');

    await page.evaluate(() =>
      window.__diceFeedback.observe(
        [
          { id: 'a', label: 'Attack', notation: '1d20 + 4', status: 'rolling' },
          { id: 'b', label: 'Damage', notation: '2d6 + 2', status: 'rolling' },
        ],
        true,
      ),
    );
    await page.waitForFunction(
      () => document.querySelector('#dice-label')?.textContent === 'Attack',
    );
    await page.screenshot({ path: '/tmp/dm-dice-feedback-ui.png' });
    await page.waitForTimeout(120);
    await page.evaluate(() =>
      window.__diceFeedback.observe(
        [
          {
            id: 'a',
            label: 'Attack',
            notation: '1d20 + 4',
            status: 'complete',
            total: 18,
            dice: [14],
            modifier: 4,
          },
          {
            id: 'b',
            label: 'Damage',
            notation: '2d6 + 2',
            status: 'complete',
            total: 9,
            dice: [3, 4],
            modifier: 2,
          },
        ],
        false,
      ),
    );
    await page.waitForFunction(() => document.querySelector('#dice-total')?.textContent === '18');
    assert.equal(await page.locator('#dice-breakdown').textContent(), '14 + 4 = 18');
    await page.waitForFunction(
      () => document.querySelector('#dice-label')?.textContent === 'Damage',
      { timeout: 5000 },
    );
    await page.waitForFunction(() => document.querySelector('#dice-total')?.textContent === '9');

    await page.evaluate(() => {
      window.__diceFeedback.reset([]);
      window.__reduceMotion = true;
      window.__diceFeedback.observe(
        [
          {
            id: 'reduced',
            label: 'Wisdom save',
            notation: '1d20',
            status: 'complete',
            total: 12,
            dice: [12],
          },
        ],
        true,
      );
    });
    await page.waitForFunction(() => document.querySelector('#dice-total')?.textContent === '12', {
      timeout: 300,
    });
    assert.equal(
      await page.locator('#dice-total').evaluate((el) => el.classList.contains('rolling')),
      false,
    );
    assert.equal(await page.locator('#dice-total').getAttribute('aria-hidden'), 'true');

    await page.evaluate(() => {
      window.__reduceMotion = true;
      window.__diceFeedback.reset([]);
      window.__diceFeedback.observe(
        [{ id: 'late', label: 'Late save', notation: '1d20', status: 'rolling' }],
        true,
      );
      window.__diceFeedback.observe(
        [{ id: 'late', label: 'Late save', notation: '1d20', status: 'rolling' }],
        false,
      );
    });
    await page.waitForFunction(
      () => document.querySelector('#dice-total')?.textContent === 'Unavailable',
    );
    await page.evaluate(() =>
      window.__diceFeedback.observe(
        [
          {
            id: 'late',
            label: 'Late save',
            notation: '1d20',
            status: 'complete',
            total: 17,
            dice: [17],
          },
        ],
        false,
      ),
    );
    await page.waitForFunction(() => document.querySelector('#dice-total')?.textContent === '17');

    await page.evaluate(() => {
      window.__diceFeedback.reset([]);
      window.__diceFeedback.observe(
        [{ id: 'closed-late', label: 'Late save', notation: '1d20', status: 'rolling' }],
        true,
      );
      window.__diceFeedback.observe(
        [{ id: 'closed-late', label: 'Late save', notation: '1d20', status: 'rolling' }],
        false,
      );
    });
    await page.waitForFunction(
      () => document.querySelector('#dice-total')?.textContent === 'Unavailable',
    );
    await page.waitForFunction(() => document.querySelector('#dice-feedback')?.hidden === true, {
      timeout: 3000,
    });
    await page.evaluate(() =>
      window.__diceFeedback.observe(
        [
          {
            id: 'closed-late',
            label: 'Late save',
            notation: '1d20',
            status: 'complete',
            total: 16,
            dice: [16],
          },
        ],
        false,
      ),
    );
    await page.waitForFunction(() => document.querySelector('#dice-total')?.textContent === '16');

    await page.evaluate(() => {
      window.__diceFeedback.reset([]);
      window.__diceFeedback.observe(
        [{ id: 'failed-late', label: 'Retry', notation: '1d20', status: 'failed' }],
        true,
      );
    });
    await page.waitForFunction(
      () => document.querySelector('#dice-total')?.textContent === 'Unavailable',
    );
    await page.waitForFunction(() => document.querySelector('#dice-feedback')?.hidden === true, {
      timeout: 3000,
    });
    await page.evaluate(() =>
      window.__diceFeedback.observe(
        [
          {
            id: 'failed-late',
            label: 'Retry',
            notation: '1d20',
            status: 'complete',
            total: 6,
            dice: [6],
          },
        ],
        false,
      ),
    );
    await page.waitForFunction(() => document.querySelector('#dice-total')?.textContent === '6');

    await page.evaluate(() => {
      window.__diceFeedback.reset([]);
      window.__diceFeedback.observe(
        [{ id: 'retry', label: 'Retry', notation: '1d20', status: 'failed' }],
        true,
      );
      window.__diceFeedback.observe(
        [{ id: 'retry', label: 'Retry', notation: '1d20', status: 'rolling' }],
        true,
      );
    });
    await page.evaluate(() =>
      window.__diceFeedback.observe(
        [
          {
            id: 'retry',
            label: 'Retry',
            notation: '1d20',
            status: 'complete',
            total: 13,
            dice: [13],
          },
        ],
        false,
      ),
    );
    await page.waitForFunction(() => document.querySelector('#dice-total')?.textContent === '13');
    await page.waitForFunction(() => document.querySelector('#dice-feedback')?.hidden === true, {
      timeout: 3000,
    });
    await page.waitForTimeout(100);
    assert.equal(
      await page.locator('#dice-feedback').isHidden(),
      true,
      'retry completion appears only once',
    );

    await page.evaluate(() => {
      window.__diceFeedback.reset([]);
      window.__diceFeedback.observe(
        [{ id: 'pending', label: 'Check', notation: '1d20', status: 'rolling' }],
        true,
      );
    });
    await page.locator('#dice-dismiss').click();
    await page.evaluate(() =>
      window.__diceFeedback.observe(
        [
          {
            id: 'pending',
            label: 'Check',
            notation: '1d20',
            status: 'complete',
            total: 5,
            dice: [5],
          },
        ],
        false,
      ),
    );
    assert.equal(await page.locator('#dice-feedback').isHidden(), true);
    await page.waitForTimeout(100);
    assert.equal(
      await page.locator('#dice-feedback').isHidden(),
      true,
      'manual dismissal suppresses late completion',
    );
    await page.evaluate(() => {
      window.__diceFeedback.observe(
        [{ id: 'cancel', label: 'Cancel', notation: '1d20', status: 'rolling' }],
        true,
      );
      window.__diceFeedback.cancel();
    });
    await page.waitForTimeout(1000);
    assert.equal(
      await page.locator('#dice-feedback').isHidden(),
      true,
      'cancel clears animation timers',
    );
  },
);
