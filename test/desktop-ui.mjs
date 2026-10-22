import test from 'node:test';
import assert from 'node:assert/strict';
import { _electron } from 'playwright-core';
import electron from 'electron';
import { mkdtemp, mkdir, readFile, writeFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fixture, apply } from './helpers.mjs';
import sharp from 'sharp';
import { createServer } from 'node:http';
import { renderMapImage } from '../dist/maps.js';

test(
  'Electron renders setup, exact sheets and maps, hotseat switching, safe narration and restart recovery',
  { timeout: 60000 },
  async (t) => {
    const { store, service } = await fixture(t);
    const example = JSON.parse(await readFile('examples/lantern-ford.json', 'utf8'));
    await apply(service, example.changes);
    await service.execute('create_location_map', {
      operationId: 'ui-map',
      expectedRevision: 1,
      reason: 'UI fixture',
      entity: example.bridgeMap,
    });
    await apply(service, [
      {
        type: 'set_positions',
        map: example.bridgeMap.id,
        positions: [
          { entityId: 'mara', x: 2, y: 2 },
          { entityId: 'tess', x: 3, y: 2 },
        ],
      },
    ]);
    await store.transact(
      { operationId: 'ui-submit', expectedRevision: 3, actor: 'test', reason: 'UI fixture' },
      { ui: 'submit' },
      () => ({
        changes: [],
        records: [],
        table: {
          type: 'submit',
          id: 'ui-turn',
          characterId: 'mara',
          text: 'I step onto the old bridge. What can I see?',
        },
      }),
    );
    await service.execute('publish_table_message', {
      operationId: 'ui-publish',
      expectedRevision: 4,
      reason: 'UI fixture',
      requestId: 'ui-turn',
      text: 'The boards creak beneath your boots. Below, the river carries the last light of dusk toward the island. Oren raises his lantern from the landing.\n\nA weathered sign points toward the tollhouse. Tess waits at your shoulder. Which way do you go?\n\n<script>window.UNSAFE = true</script>',
    });
    const background = join(store.root, 'assets/ui-background.png');
    await writeFile(
      background,
      process.env.DM_UI_BACKGROUND
        ? await readFile(process.env.DM_UI_BACKGROUND)
        : await sharp({ create: { width: 80, height: 70, channels: 3, background: '#978c60' } })
            .png()
            .toBuffer(),
    );
    await service.execute('register_map_art', {
      operationId: 'ui-background',
      expectedRevision: 5,
      reason: 'UI artwork fixture',
      mapId: example.bridgeMap.id,
      art: {
        path: 'assets/ui-background.png',
        purpose: 'Background',
        sourceRevision: 3,
        visibility: 'party',
        background: { extent: { x: 0, y: 0, width: 8, height: 7 } },
      },
    });
    const artifacts = await mkdtemp(join(tmpdir(), 'dm-desktop-ui-'));
    console.log(`Desktop screenshots: ${artifacts}`);
    const env = {
      ...process.env,
      DM_DESKTOP_NODE: process.execPath,
      DM_DESKTOP_USER_DATA: join(artifacts, 'profile'),
    };
    delete env.ELECTRON_RUN_AS_NODE;
    let app;
    t.after(async () => {
      await app?.close();
    });
    const launch = async () => {
      app = await _electron.launch({
        executablePath: electron,
        args: [
          ...(process.platform === 'linux' ? ['--ozone-platform=x11'] : []),
          resolve('build/desktop/main.mjs'),
        ],
        env,
        timeout: 20000,
      });
      return app.firstWindow();
    };
    let page = await launch();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.waitForSelector('#create-form');
    await page.locator('#provider').selectOption('codex');
    await page.waitForFunction(async () => (await window.table.preferences()).provider === 'codex');
    assert.equal(await page.locator('#provider-command').innerText(), 'codex login');
    await page.screenshot({ path: join(artifacts, 'setup.png') });
    const metadata = createServer((req, res) => {
      res.setHeader('Content-Type', 'application/json');
      res.end(
        JSON.stringify(
          req.url === '/api/tags'
            ? { models: [{ name: 'custom:vision', size: 6 * 1024 ** 3 }] }
            : { capabilities: ['vision', 'tools'], model_info: { 'custom.context_length': 65536 } },
        ),
      );
    });
    await new Promise((r) => metadata.listen(0, '127.0.0.1', r));
    t.after(() => new Promise((r) => metadata.close(r)));
    await page.locator('#provider').selectOption('ollama');
    await page.locator('#local-settings').waitFor({ state: 'visible' });
    await page.locator('#local-model').fill('custom:vision');
    await page.locator('#local-endpoint').fill(`http://127.0.0.1:${metadata.address().port}`);
    await page.locator('#local-context').fill('32768');
    await page.locator('#local-check').click();
    await page.waitForFunction(() =>
      document.querySelector('#local-status').textContent.includes('Vision + tools confirmed'),
    );
    assert.match(await page.locator('#local-hardware').innerText(), /GiB RAM/);
    assert.equal(
      await page.locator('#local-models option').first().getAttribute('value'),
      'custom:vision',
    );
    await page.locator('#local-save').click();
    await page.waitForFunction(
      async () => (await window.table.preferences()).local?.model === 'custom:vision',
    );
    await page.screenshot({ path: join(artifacts, 'local-setup.png') });
    await page.locator('#provider').selectOption('codex');
    await page.waitForFunction(async () => (await window.table.preferences()).provider === 'codex');
    assert.equal(await page.locator('#local-settings').isHidden(), true);

    const security = await app.evaluate(({ BrowserWindow }) => {
      const prefs = BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences();
      return {
        node: prefs.nodeIntegration,
        isolated: prefs.contextIsolation,
        sandbox: prefs.sandbox,
      };
    });
    assert.deepEqual(security, { node: false, isolated: true, sandbox: true });
    assert.equal(await page.evaluate(() => typeof window.require), 'undefined');
    // Exercise the same bridge and renderer used by the file-picker path, without opening a native dialog or invoking a model.
    const load = async (page) =>
      page.evaluate(async (root) => {
        const { showCampaign } = await import('./app.js');
        showCampaign(await window.table.open(root));
      }, store.root);
    await load(page);
    await page.waitForFunction(() => document.getElementById('map-image').naturalWidth > 0);
    assert.match(await page.locator('#transcript').innerText(), /boards creak/);
    assert.match(await page.locator('#transcript').innerText(), /Turn interrupted/);
    assert.equal(await page.evaluate(() => window.UNSAFE), undefined);
    assert.doesNotMatch(await page.locator('body').innerText(), /stranded keeper|stranded child/);
    await page.locator('#party button').first().click();
    assert.match(await page.locator('#acting-as').innerText(), /Mara/);
    assert.match(await page.locator('#sheet').innerText(), /Healing potion/);
    await page.locator('#pass').click();
    assert.match(await page.locator('#acting-as').innerText(), /Tess/);
    await page.locator('#party button').first().click();
    await page.locator('#map-select').selectOption(example.bridgeMap.id);
    await page.waitForFunction(() => !document.getElementById('map-image').hidden);
    await page.waitForFunction(
      () =>
        !document.getElementById('map-image').hidden &&
        document.getElementById('map-status').textContent.startsWith('r'),
    );
    assert.equal(await page.locator('#map-size').inputValue(), 'auto');
    const viewport = {
      x: 0,
      y: 0,
      width: Math.min(40, example.bridgeMap.map.bounds.width),
      height: Math.min(40, example.bridgeMap.map.bounds.height),
    };
    const expected = await renderMapImage(
      store.root,
      (await store.read()).state,
      example.bridgeMap.id,
      'party',
      viewport,
      'map',
      'canvas',
    );
    assert.equal(
      await page.locator('#map-image').getAttribute('src'),
      `data:image/png;base64,${expected.png.toString('base64')}`,
    );
    await page.screenshot({ path: join(artifacts, 'table.png') });
    // Canvas framing gives the map space; the document legend remains a functional toggle.
    const canvas = await page.locator('#map-image').getAttribute('src');
    await page.locator('#map-details').click();
    await page.waitForFunction(
      (previous) =>
        !document.getElementById('map-image').hidden &&
        document.getElementById('map-image').src !== previous,
      canvas,
    );
    assert.equal(await page.locator('#map-details').getAttribute('aria-pressed'), 'true');
    const documentMap = await renderMapImage(
      store.root,
      (await store.read()).state,
      example.bridgeMap.id,
      'party',
      viewport,
    );
    assert.equal(
      await page.locator('#map-image').getAttribute('src'),
      `data:image/png;base64,${documentMap.png.toString('base64')}`,
    );
    await page.locator('#map-details').click();
    await page.locator('#map-size').selectOption('12');
    await page.locator('#pan-right').click();
    await page.waitForFunction(() =>
      document.getElementById('map-status').textContent.includes('5, 0'),
    );
    await page.locator('#map-size').selectOption('auto');
    await page.waitForFunction(() =>
      document.getElementById('map-status').textContent.includes('0, 0'),
    );
    await page.locator('#scene-title').click();
    assert.ok(await page.locator('#scene-summary').isVisible());
    await page.locator('#scene-title').click();
    // Supported minimum window size keeps the composer and map controls on screen.
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1000, 720));
    await page.waitForTimeout(150);
    assert.equal(
      await page.evaluate(
        () =>
          document.documentElement.scrollWidth <= innerWidth &&
          document.documentElement.scrollHeight <= innerHeight,
      ),
      true,
    );
    const sendBounds = await page.locator('#send').boundingBox();
    assert.ok(sendBounds.y + sendBounds.height <= (await page.evaluate(() => innerHeight)));
    await page.screenshot({ path: join(artifacts, 'compact.png') });

    await page.locator('#lan-host').click();
    await page.locator('#lan-dialog[open]').waitFor();
    await page.waitForFunction(() => document.querySelector('#lan-qr').naturalWidth > 0);
    const sharing = await page.evaluate(() => window.table.lanStatus());
    assert.match(sharing.urls[0], /^http:\/\/127\.0\.0\.1:/);
    await page.locator('#lan-play').click();
    for (let i = 0; i < 50 && app.windows().length < 2; i++) await page.waitForTimeout(50);
    const player = app.windows().find((p) => p !== page);
    assert.ok(player);
    await player.locator('#name').fill('Local host');
    await player.getByRole('button', { name: 'Join game', exact: true }).click();
    await player.locator('#game').waitFor();
    assert.equal(await player.evaluate(() => typeof window.require), 'undefined');
    await player.close();
    await page.locator('#lan-stop').click();
    await page.waitForFunction(() => !document.querySelector('#lan-dialog').open);
    const revision = (await store.read()).state.revision;
    await unlink(background);
    await apply(service, [{ type: 'damage', id: 'mara', amount: 2 }]);
    await page.waitForFunction(
      (r) => document.getElementById('revision').textContent.includes(`r${r}`),
      revision + 1,
    );
    assert.match(await page.locator('#party').innerText(), /7 \/ 12 HP/);
    await page.waitForFunction(() =>
      document.getElementById('map-status').textContent.includes('missing, changed, or unreadable'),
    );
    await app.close();
    app = undefined;
    page = await launch();
    assert.equal(
      (await page.evaluate(() => window.table.preferences())).local.model,
      'custom:vision',
    );
    await load(page);
    assert.match(await page.locator('#transcript').innerText(), /boards creak/);
    assert.match(await page.locator('#party').innerText(), /7 \/ 12 HP/);
    assert.equal((await store.read()).state.table.length, 1);
    assert.deepEqual(errors, []);
    // Prove desktop creation retains the existing campaign-bound ChatGPT/Codex plugin setup.
    const parent = join(artifacts, 'new-campaigns');
    await mkdir(parent);
    const created = await page.evaluate(
      (parent) =>
        window.table.create({ parent, slug: 'new-table', name: 'New Table', edition: '2024' }),
      parent,
    );
    assert.equal(created.campaign.name, 'New Table');
    assert.equal(created.reviewMode, 'setup');
    assert.match(
      await readFile(join(parent, 'new-table/.codex/config.toml'), 'utf8'),
      /dungeon-master/,
    );
    const plugin = JSON.parse(
      await readFile(join(parent, 'new-table/.dm/plugin/mcp.json'), 'utf8'),
    );
    assert.ok(JSON.stringify(plugin).includes('dist/server.js'));
  },
);
