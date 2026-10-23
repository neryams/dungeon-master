import test from 'node:test';
import assert from 'node:assert/strict';
import { _electron } from 'playwright-core';
import electron from 'electron';
import { mkdtemp, mkdir, readFile, writeFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fixture, apply, FileJournal } from './helpers.mjs';
import { CampaignStore } from '../dist/store.js';
import { CampaignService } from '../dist/service.js';
import { JournalAdapter } from '../dist/journal.js';
import sharp from 'sharp';
import { createServer } from 'node:http';
import { renderMapImage } from '../dist/maps.js';

async function fakeCodexCli(directory) {
  const path = join(directory, 'codex-fixture.mjs');
  const requests = join(directory, 'codex-requests.jsonl');
  await writeFile(
    path,
    `#!/usr/bin/env node
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createInterface } from 'node:readline';
const args = process.argv.slice(2);
if (args[0] === '--version') { process.stdout.write('codex fixture 1.0\\n'); process.exit(0); }
if (args[0] === 'app-server' && args[1] === '--help') { process.stdout.write('app-server --listen\\n'); process.exit(0); }
if (args[0] !== 'app-server') process.exit(2);
const send = (message) => process.stdout.write(JSON.stringify(message) + '\\n');
const log = (message) => appendFileSync(process.env.DM_FAKE_CODEX_LOG, JSON.stringify(message) + '\\n');
let turn = 0;
let serverName;
createInterface({ input: process.stdin }).on('line', (line) => {
  const message = JSON.parse(line);
  log(message);
  if (message.method === 'initialize') send({ id: message.id, result: {} });
  if (message.method === 'account/read') send({ id: message.id, result: { account: { type: 'chatgpt' } } });
  if (message.method === 'config/read') send({ id: message.id, result: { config: { mcp_servers: { unrelated: { command: 'ignored', args: [] } } } } });
  if (message.method === 'model/list') {
    const data = [
      { model: 'gpt-6-sol', displayName: 'GPT-6 Sol', defaultReasoningEffort: 'medium', isDefault: true },
    ];
    if (!existsSync(process.env.DM_FAKE_CODEX_HIDE_ASTRA)) data.push({
      model: 'gpt-6-astra',
      displayName: 'GPT-6 Astra · extended reasoning and context',
      defaultReasoningEffort: 'high',
    });
    send({ id: message.id, result: { data, nextCursor: null } });
  }
  if (message.method === 'thread/start' || message.method === 'thread/resume') {
    serverName = Object.entries(message.params.config.mcp_servers).find(([, server]) => server.enabled && server.required)?.[0];
    const id = message.params.model === 'gpt-6-astra' ? 'fixture-astra' : message.params.model === 'gpt-6-sol' ? 'fixture-sol' : 'fixture-default';
    send({ id: message.id, result: { thread: { id } } });
  }
  if (message.method === 'turn/start') {
    const prompt = message.params.input?.[0]?.text ?? '';
    if (!prompt.startsWith('Connection check only.')) process.exit(3);
    const id = 'fixture-turn-' + (++turn);
    const threadId = message.params.threadId;
    send({ method: 'turn/started', params: { threadId, turn: { id } } });
    send({ id: message.id, result: { turn: { id } } });
    const finishConnectionCheck = () => {
      const campaign = JSON.parse(readFileSync(resolve(process.cwd(), '../../..', 'campaign.json'), 'utf8'));
      const output = { campaign: { schemaVersion: campaign.schemaVersion, id: campaign.id }, revision: 0, journal: {} };
      const item = { type: 'mcpToolCall', server: serverName, tool: 'campaign_status', status: 'completed', result: { content: [{ type: 'text', text: JSON.stringify(output) }] } };
      send({ method: 'item/completed', params: { threadId, turnId: id, item } });
      send({ method: 'turn/completed', params: { threadId, turn: { id, status: 'completed' } } });
    };
    if (threadId === 'fixture-astra') setTimeout(finishConnectionCheck, 500);
    else finishConnectionCheck();
  }
});
`,
    { mode: 0o755 },
  );
  return { path, requests, hideAstra: join(directory, 'hide-astra') };
}

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
      text: `The boards creak beneath your boots. Below, the river carries the last light of dusk toward the island. Oren raises his lantern from the landing.

## The Tollhouse

A weathered sign points toward the tollhouse. Tess **waits** at your *shoulder*. Which way do you go?

- The lantern flickers.
- The river runs below.

1. Inspect the sign.
2. Cross the bridge.

The worn words read \`old bridge\`.

\`\`\`text
The boards creak.
\`\`\`

<script>window.UNSAFE = true</script>
<img src="https://example.invalid/hostile.png" onerror="window.UNSAFE = true">
<div onclick="window.UNSAFE = true">raw HTML stays text</div>
![remote image](https://example.invalid/markdown.png)
[unsafe link](javascript:window.UNSAFE = true)`,
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
      DM_FAKE_CODEX_LOG: join(artifacts, 'codex-requests.jsonl'),
      DM_FAKE_CODEX_HIDE_ASTRA: join(artifacts, 'hide-astra'),
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
    const fakeCodex = await fakeCodexCli(artifacts);
    await page.evaluate((path) => window.table.detect(path), fakeCodex.path);
    await page.locator('#refresh-models').click();
    await page.waitForFunction(() =>
      document.querySelector('#models-status').textContent.includes('2 models available'),
    );
    assert.deepEqual(
      await page
        .locator('#provider-model option')
        .evaluateAll((options) => options.map((option) => [option.value, option.textContent])),
      [
        ['', 'CLI default'],
        ['gpt-6-sol', 'GPT-6 Sol'],
        ['gpt-6-astra', 'GPT-6 Astra · extended reasoning and context'],
      ],
    );
    await page.locator('#provider-model').selectOption('gpt-6-sol');
    await page.waitForFunction(
      async () => (await window.table.preferences()).models?.codex === 'gpt-6-sol',
    );
    await page.waitForFunction(
      () =>
        document.querySelector('#models-status').textContent ===
        'Model selected for this provider.',
    );
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
    assert.equal(
      (await page.evaluate(() => window.table.preferences())).models.codex,
      'gpt-6-sol',
      'Switching through local mode preserves the Codex model choice',
    );

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
    const savedBeforeModelSwitch = await store.read();
    const hitPointsBeforeModelSwitch = Object.entries(savedBeforeModelSwitch.state.entities)
      .filter(([, entity]) => entity.kind === 'character')
      .map(([id, entity]) => [id, entity.character.hp]);
    await page.evaluate(async () => {
      await window.table.connect();
      const { showCampaign } = await import('./app.js');
      showCampaign(await window.table.snapshot());
    });
    await page.waitForFunction(
      () => document.querySelector('#connection').textContent === 'DM model…',
    );
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1000, 720));
    await page.waitForTimeout(150);
    const sessionPath = join(store.root, '.dm/hotseat/codex-session.json');
    const sessionBeforeSwitch = JSON.parse(await readFile(sessionPath, 'utf8'));
    assert.equal(sessionBeforeSwitch.model, 'gpt-6-sol');
    await page.locator('#connection').click();
    await page.locator('#model-dialog[open]').waitFor();
    await page.waitForFunction(() =>
      document.querySelector('#model-dialog-status').textContent.includes('Choose a model'),
    );
    await page.locator('#switch-model').selectOption('gpt-6-astra');
    assert.equal(
      await page.locator('#switch-model option:checked').innerText(),
      'GPT-6 Astra · extended reasoning and context',
    );
    assert.equal(await page.locator('#model-apply').isDisabled(), false);
    const modelDialogLayout = await page.evaluate(() => {
      const dialog = document.querySelector('#model-dialog');
      const select = document.querySelector('#switch-model');
      const bounds = dialog.getBoundingClientRect();
      const selectBounds = select.getBoundingClientRect();
      return {
        viewportWidth: innerWidth,
        pageScrollWidth: document.documentElement.scrollWidth,
        dialogLeft: bounds.left,
        dialogRight: bounds.right,
        selectLeft: selectBounds.left,
        selectRight: selectBounds.right,
        dialogClientWidth: dialog.clientWidth,
        dialogScrollWidth: dialog.scrollWidth,
      };
    });
    assert.ok(
      modelDialogLayout.pageScrollWidth <= modelDialogLayout.viewportWidth,
      `Page has horizontal overflow at minimum size: ${JSON.stringify(modelDialogLayout)}`,
    );
    assert.ok(
      modelDialogLayout.dialogLeft >= 0 &&
        modelDialogLayout.dialogRight <= modelDialogLayout.viewportWidth,
      `Model dialog exceeds viewport at minimum size: ${JSON.stringify(modelDialogLayout)}`,
    );
    assert.ok(
      modelDialogLayout.selectLeft >= modelDialogLayout.dialogLeft &&
        modelDialogLayout.selectRight <= modelDialogLayout.dialogRight,
      `Model option selector exceeds the dialog: ${JSON.stringify(modelDialogLayout)}`,
    );
    assert.ok(
      modelDialogLayout.dialogScrollWidth <= modelDialogLayout.dialogClientWidth,
      `Model dialog has horizontal overflow at minimum size: ${JSON.stringify(modelDialogLayout)}`,
    );
    await page.screenshot({ path: join(artifacts, 'model-switch-ready.png') });
    const modelWarning = await page.locator('#model-dialog').innerText();
    assert.match(modelWarning, /fresh DM conversation/i);
    assert.match(modelWarning, /cached tokens may need to be rebuilt/i);
    assert.match(modelWarning, /saved campaign, characters, maps and history are preserved/i);
    await page.locator('#model-cancel').click();
    await page.waitForFunction(() => !document.querySelector('#model-dialog').open);
    assert.equal((await page.evaluate(() => window.table.preferences())).models.codex, 'gpt-6-sol');
    assert.deepEqual(JSON.parse(await readFile(sessionPath, 'utf8')), sessionBeforeSwitch);

    await page.locator('#connection').click();
    await page.locator('#model-dialog[open]').waitFor();
    await page.waitForFunction(() => !document.querySelector('#switch-model').disabled);
    await page.locator('#switch-model').selectOption('gpt-6-astra');
    assert.equal(await page.locator('#model-apply').isDisabled(), false);
    await page.locator('#model-apply').click();
    await page.waitForFunction(() => document.querySelector('#model-cancel').disabled);
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#model-dialog').evaluate((dialog) => dialog.open), true);
    assert.equal(await page.locator('#model-cancel').isDisabled(), true);
    await page.waitForFunction(() => !document.querySelector('#model-dialog').open);
    await page.waitForFunction(
      async () => (await window.table.preferences()).models?.codex === 'gpt-6-astra',
    );
    const sessionAfterSwitch = JSON.parse(await readFile(sessionPath, 'utf8'));
    assert.equal(sessionAfterSwitch.model, 'gpt-6-astra');
    assert.notEqual(sessionAfterSwitch.conversationId, sessionBeforeSwitch.conversationId);
    const savedAfterModelSwitch = await store.read();
    assert.equal(savedAfterModelSwitch.state.revision, savedBeforeModelSwitch.state.revision);
    assert.deepEqual(savedAfterModelSwitch.state.table, savedBeforeModelSwitch.state.table);
    assert.deepEqual(
      Object.entries(savedAfterModelSwitch.state.entities)
        .filter(([, entity]) => entity.kind === 'character')
        .map(([id, entity]) => [id, entity.character.hp]),
      hitPointsBeforeModelSwitch,
    );
    const fakeRequests = (await readFile(fakeCodex.requests, 'utf8'))
      .trim()
      .split('\n')
      .map(JSON.parse);
    const starts = fakeRequests.filter((request) => request.method === 'thread/start');
    assert.deepEqual(
      starts.map((request) => request.params.model),
      ['gpt-6-sol', 'gpt-6-astra'],
    );
    for (const request of starts) {
      const servers = request.params.config.mcp_servers;
      assert.equal(servers.unrelated.enabled, false);
      const active = Object.entries(servers).filter(
        ([, server]) => server.enabled && server.required,
      );
      assert.equal(active.length, 1);
      assert.match(active[0][0], /^dm-hotseat-[a-f0-9]{12}$/);
    }
    assert.ok(
      fakeRequests
        .filter((request) => request.method === 'turn/start')
        .every((request) => request.params.input[0].text.startsWith('Connection check only.')),
      'The fake provider should only receive read-only connection checks',
    );
    await writeFile(fakeCodex.hideAstra, 'hide Astra from the catalog\n');
    const unavailableModelError = await page.evaluate(async () => {
      try {
        await window.table.connect();
        return null;
      } catch (error) {
        return error instanceof Error ? error.message : String(error);
      }
    });
    assert.match(unavailableModelError, /That model is unavailable/);
    const afterUnavailableModel = (await readFile(fakeCodex.requests, 'utf8'))
      .trim()
      .split('\n')
      .map(JSON.parse);
    assert.equal(
      afterUnavailableModel.filter((request) => request.method === 'thread/start').length,
      starts.length,
      'An unavailable saved model must be rejected before a new thread starts',
    );
    assert.deepEqual(JSON.parse(await readFile(sessionPath, 'utf8')), sessionAfterSwitch);
    assert.equal(
      (await page.evaluate(() => window.table.preferences())).models.codex,
      'gpt-6-astra',
    );
    const afterUnavailableState = await store.read();
    assert.equal(afterUnavailableState.state.revision, savedAfterModelSwitch.state.revision);
    assert.deepEqual(afterUnavailableState.state.table, savedAfterModelSwitch.state.table);
    await page.waitForFunction(() => document.getElementById('map-image').naturalWidth > 0);
    assert.match(await page.locator('#transcript').innerText(), /boards creak/);
    assert.match(await page.locator('#transcript').innerText(), /Turn interrupted/);
    const narration = page.locator('#transcript .message-markdown:has(h2)');
    assert.equal(await narration.locator('h2').count(), 1);
    assert.equal(await narration.locator('strong').innerText(), 'waits');
    assert.equal(await narration.locator('em').innerText(), 'shoulder');
    assert.equal(await narration.locator('ul li').count(), 2);
    assert.equal(await narration.locator('ol li').count(), 2);
    assert.equal(await narration.locator('code').count(), 2);
    assert.equal(await narration.locator('pre code').count(), 1);
    assert.equal(
      await page.locator('#transcript script, #transcript img, #transcript a').count(),
      0,
    );
    assert.match(
      await page.locator('#transcript').innerText(),
      /<script>window\.UNSAFE = true<\/script>/,
    );
    assert.match(await page.locator('#transcript').innerText(), /<img src=/);
    assert.match(await page.locator('#transcript').innerText(), /unsafe link/);
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

    // A newly created campaign opens a conversational setup, including after reopening.
    await page.evaluate(async () => {
      const { showCampaign } = await import('./app.js');
      showCampaign(await window.table.snapshot());
    });
    await page.locator('#setup-guide').waitFor({ state: 'visible' });
    assert.equal(await page.locator('.party-pane').isHidden(), true);
    assert.equal(await page.locator('.map-pane').isHidden(), true);
    assert.equal(await page.locator('#lan-host').isDisabled(), true);
    assert.match(await page.locator('#setup-guide').innerText(), /surprise me/);
    assert.match(await page.locator('#setup-progress').innerText(), /Party to create/);
    assert.match(await page.locator('#action').getAttribute('placeholder'), /Describe your idea/);
    assert.equal(await page.locator('#setup-activity').isHidden(), true);
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1000, 720));
    const setupSend = await page.locator('#send').boundingBox();
    assert.ok(setupSend.y + setupSend.height <= (await page.evaluate(() => innerHeight)));
    await page.screenshot({ path: join(artifacts, 'campaign-setup.png') });
    // Freeze polling while presenting synthetic host stages; no provider/model is invoked.
    await page.clock.install();
    await page.clock.pauseAt(new Date(Date.now() + 1000));
    await page.evaluate(async () => {
      const { showCampaign } = await import('./app.js');
      showCampaign({ ...(await window.table.snapshot()), stage: 'resolving' });
    });
    assert.equal(await page.locator('#setup-activity').isVisible(), true);
    assert.match(await page.locator('#setup-activity-detail').innerText(), /Turning your ideas/);
    const busySend = await page.locator('#send').boundingBox();
    assert.ok(busySend.y + busySend.height <= (await page.evaluate(() => innerHeight)));
    await page.screenshot({ path: join(artifacts, 'campaign-generating.png') });
    await page.evaluate(async () => {
      const { showCampaign } = await import('./app.js');
      showCampaign({ ...(await window.table.snapshot()), stage: 'attention' });
    });
    assert.equal(await page.locator('#setup-activity').isHidden(), true);
    await page.evaluate(async () => {
      const { showCampaign } = await import('./app.js');
      showCampaign({
        ...(await window.table.snapshot()),
        reviewMode: 'reviewed',
        stage: 'resolving',
      });
    });
    assert.equal(
      await page.locator('#setup-activity').isHidden(),
      true,
      'Ordinary play uses its existing activity indicator',
    );
    await page.evaluate(async () => {
      const { showCampaign } = await import('./app.js');
      showCampaign(await window.table.snapshot());
    });
    await page.clock.resume();

    const setupStore = await CampaignStore.open(created.root);
    const setupService = new CampaignService(
      setupStore,
      new JournalAdapter(setupStore, new FileJournal(setupStore.root)),
    );
    await apply(setupService, example.changes);
    await setupService.execute('create_location_map', {
      operationId: 'setup-map',
      expectedRevision: (await setupStore.read()).state.revision,
      reason: 'Prepare the starting map',
      entity: example.bridgeMap,
    });
    await page.waitForFunction(() =>
      document.getElementById('setup-progress').textContent.includes('Map saved'),
    );
    assert.match(await page.locator('#setup-progress').innerText(), /Party saved · 2 characters/);
    await page.clock.pauseAt(new Date(Date.now() + 2000));
    await page.evaluate(async () => {
      const { showCampaign } = await import('./app.js');
      showCampaign({ ...(await window.table.snapshot()), stage: 'resolving' });
    });
    assert.match(await page.locator('#setup-activity-detail').innerText(), /checking the details/);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    assert.equal(
      await page.locator('.setup-spinner').evaluate((e) => getComputedStyle(e).animationName),
      'none',
    );
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.evaluate(async () => {
      const { showCampaign } = await import('./app.js');
      showCampaign(await window.table.snapshot());
    });
    await page.clock.resume();
    assert.equal(
      await page.locator('#setup-guide').isVisible(),
      true,
      'A party and map alone do not finish setup',
    );
    await app.close();
    app = undefined;
    page = await launch();
    await page.evaluate(async (root) => {
      const { showCampaign } = await import('./app.js');
      showCampaign(await window.table.open(root));
    }, created.root);
    await page.locator('#setup-guide').waitFor({ state: 'visible' });
    assert.match(await page.locator('#setup-progress').innerText(), /Map saved/);
    await setupService.execute('configure_review', {
      operationId: 'setup-verified',
      expectedRevision: (await setupStore.read()).state.revision,
      reason: 'Opening verified for the UI fixture',
      mode: 'reviewed',
    });
    await page.locator('#setup-guide').waitFor({ state: 'hidden' });
    assert.equal(await page.locator('.party-pane').isVisible(), true);
    assert.equal(await page.locator('.map-pane').isVisible(), true);
    assert.equal(await page.locator('#lan-host').isEnabled(), true);
    await page.locator('#map-image:not([hidden])').waitFor();
    assert.match(await page.locator('#party').innerText(), /Mara/);
    assert.deepEqual(errors, []);
  },
);
