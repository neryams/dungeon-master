import test from 'node:test';
import assert from 'node:assert/strict';
import { _electron } from 'playwright-core';
import electron from 'electron';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fixture, apply, hero } from './helpers.mjs';

test(
  'Electron desktop events deliver safely, update dice immediately, reload saved state and clean up on switch',
  { timeout: 30000 },
  async (t) => {
    const artifacts = await mkdtemp(join(tmpdir(), 'dm-desktop-events-'));
    const first = await fixture(t);
    const second = await fixture(t);
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

    // Concurrent settings saves share one preferences file and must be serialized.
    await page.evaluate(async () => {
      await Promise.all([
        window.table.selectProvider('codex'),
        window.table.selectProvider('antigravity'),
      ]);
    });
    const opened = await page.evaluate(async (root) => {
      const snapshot = await window.table.open(root);
      const { showCampaign } = await import('./app.js');
      showCampaign(snapshot);
      return snapshot;
    }, first.store.root);
    const root = first.store.root;
    const campaignId = opened.campaign.id;
    const sequence = opened.activitySequence ?? 0;
    const dispatch = async (event) =>
      app.evaluate(
        ({ BrowserWindow }, update) =>
          BrowserWindow.getAllWindows()[0].webContents.send('table:update', update),
        event,
      );
    const event = (overrides = {}) => ({
      type: 'desktop-event',
      root,
      campaignId,
      sequence: sequence + 1,
      kind: 'activity',
      stage: 'resolving',
      detail: 'DM is working',
      activity: {
        phase: 'Resolving an attack',
        rolls: [{ id: 'event-roll', label: 'Attack', notation: '1d20 + 4', status: 'rolling' }],
      },
      ...overrides,
    });

    const received = await page.evaluate(() => {
      window.__updates = [];
      window.__unsubscribe = window.table.onUpdate((value) => window.__updates.push(value));
      return typeof window.__unsubscribe;
    });
    assert.equal(received, 'function', 'subscription returns an unsubscribe function');
    const firstUpdate = event();
    await dispatch(firstUpdate);
    await page.waitForFunction(() => window.__updates?.length === 1);
    assert.deepEqual(await page.evaluate(() => window.__updates[0]), firstUpdate);
    assert.deepEqual(
      await page.evaluate(() => Object.keys(window.__updates[0]).sort()),
      Object.keys(firstUpdate).sort(),
      'the preload callback receives the payload without Electron event metadata',
    );
    await page.evaluate(() => window.__unsubscribe());
    await dispatch(event({ sequence: sequence + 2 }));
    await page.waitForTimeout(100);
    assert.equal(
      await page.evaluate(() => window.__updates.length),
      1,
      'unsubscribe detaches listener',
    );

    await dispatch(event());
    await page.waitForFunction(
      () => document.querySelector('#dice-label')?.textContent === 'Attack',
    );
    assert.equal(await page.locator('#dice-feedback').isVisible(), true);

    await dispatch(
      event({
        root: `${root}-other`,
        sequence: sequence + 3,
        activity: {
          phase: 'Wrong root',
          rolls: [{ id: 'bad-root', label: 'Wrong root', notation: '1d20', status: 'rolling' }],
        },
      }),
    );
    await dispatch(
      event({
        sequence: sequence + 3,
        activity: {
          phase: 'After wrong root',
          rolls: [{ id: 'event-roll', label: 'Attack', notation: '1d20 + 4', status: 'rolling' }],
        },
      }),
    );
    await page.waitForFunction(
      () => document.querySelector('#active-turn-phase')?.textContent === 'After wrong root',
    );
    await dispatch(
      event({
        campaignId: `${campaignId}-other`,
        sequence: sequence + 4,
        activity: {
          phase: 'Wrong campaign',
          rolls: [
            { id: 'bad-campaign', label: 'Wrong campaign', notation: '1d20', status: 'rolling' },
          ],
        },
      }),
    );
    await dispatch(
      event({
        sequence: sequence + 4,
        activity: {
          phase: 'After wrong campaign',
          rolls: [{ id: 'event-roll', label: 'Attack', notation: '1d20 + 4', status: 'rolling' }],
        },
      }),
    );
    await page.waitForFunction(
      () => document.querySelector('#active-turn-phase')?.textContent === 'After wrong campaign',
    );
    await dispatch(
      event({
        sequence: sequence + 4,
        activity: {
          phase: 'Duplicate',
          rolls: [{ id: 'duplicate', label: 'Duplicate', notation: '1d20', status: 'rolling' }],
        },
      }),
    );
    await dispatch(
      event({
        sequence: sequence + 1,
        activity: {
          phase: 'Out of order',
          rolls: [
            { id: 'out-of-order', label: 'Out of order', notation: '1d20', status: 'rolling' },
          ],
        },
      }),
    );
    assert.equal(await page.locator('#dice-label').textContent(), 'Attack');
    assert.equal(await page.locator('#active-turn-phase').textContent(), 'After wrong campaign');

    await dispatch(
      event({
        sequence: sequence + 5,
        activity: {
          phase: 'Resolving an attack',
          rolls: [
            {
              id: 'event-roll',
              label: 'Attack',
              notation: '1d20 + 4',
              status: 'complete',
              total: 18,
              dice: [14],
              modifier: 4,
            },
          ],
        },
      }),
    );
    await page.waitForFunction(() => document.querySelector('#dice-total')?.textContent === '18');
    await page.waitForFunction(
      () => document.querySelector('#dice-breakdown')?.textContent === '14 + 4 = 18',
    );
    await page.waitForTimeout(150);
    assert.equal(
      await page.locator('#active-turn-phase').textContent(),
      'Resolving an attack',
      'an older host snapshot cannot overwrite newer pushed activity',
    );
    await dispatch(
      event({
        sequence: sequence + 4,
        activity: {
          phase: 'Stale total',
          rolls: [
            {
              id: 'event-roll',
              label: 'Stale total',
              notation: '1d20',
              status: 'complete',
              total: 2,
              dice: [2],
            },
          ],
        },
      }),
    );
    await dispatch(
      event({
        sequence: sequence + 5,
        activity: {
          phase: 'Duplicate total',
          rolls: [
            {
              id: 'event-roll',
              label: 'Duplicate total',
              notation: '1d20',
              status: 'complete',
              total: 3,
              dice: [3],
            },
          ],
        },
      }),
    );
    assert.equal(await page.locator('#dice-total').textContent(), '18');

    await apply(first.service, [{ type: 'put_entity', entity: hero }]);
    const saved = await first.service.execute('campaign_status', {});
    await dispatch(
      event({
        sequence: sequence + 6,
        kind: 'changed',
        activity: undefined,
        stage: 'ready',
        detail: 'Campaign state changed',
      }),
    );
    await page.waitForFunction(
      ({ revision }) =>
        document.querySelector('#revision')?.textContent === `Saved · r${revision}` &&
        document.querySelector('#party-count')?.textContent === '1',
      { revision: saved.revision },
    );

    const secondSnapshot = await page.evaluate(async (nextRoot) => {
      const snapshot = await window.table.open(nextRoot);
      const { showCampaign } = await import('./app.js');
      showCampaign(snapshot);
      return snapshot;
    }, second.store.root);
    await dispatch(
      event({
        sequence: sequence + 7,
        activity: {
          phase: 'Previous campaign',
          rolls: [
            { id: 'old-campaign', label: 'Previous campaign', notation: '1d20', status: 'rolling' },
          ],
        },
      }),
    );
    assert.equal(
      await page.locator('#campaign-heading').textContent(),
      secondSnapshot.campaign.name,
    );
    assert.equal(await page.locator('#party-count').textContent(), '0');
    await dispatch({
      ...event(),
      root: second.store.root,
      campaignId: secondSnapshot.campaign.id,
      sequence: (secondSnapshot.activitySequence ?? 0) + 1,
      activity: {
        phase: 'New campaign',
        rolls: [{ id: 'new-campaign', label: 'New campaign', notation: '1d20', status: 'rolling' }],
      },
    });
    await page.waitForFunction(
      () => document.querySelector('#dice-label')?.textContent === 'New campaign',
    );
  },
);
