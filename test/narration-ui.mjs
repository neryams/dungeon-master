import test from 'node:test';
import assert from 'node:assert/strict';
import { _electron } from 'playwright-core';
import electron from 'electron';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fixture, apply, hero } from './helpers.mjs';

function wavBase64(durationSeconds = 2) {
  const sampleRate = 16_000;
  const samples = sampleRate * durationSeconds;
  const wav = Buffer.alloc(44 + samples * 2);
  wav.write('RIFF', 0);
  wav.writeUInt32LE(wav.length - 8, 4);
  wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(sampleRate, 24);
  wav.writeUInt32LE(sampleRate * 2, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write('data', 36);
  wav.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i += 1) {
    const value = Math.round(Math.sin((2 * Math.PI * 330 * i) / sampleRate) * 500);
    wav.writeInt16LE(value, 44 + i * 2);
  }
  return wav.toString('base64');
}

async function fakeSpeechHome(directory) {
  const home = join(directory, 'speech-home');
  const python = join(home, 'venv', 'bin', 'python');
  const log = join(directory, 'speech-requests.jsonl');
  await mkdir(join(home, 'model'), { recursive: true });
  await mkdir(join(home, 'voices'), { recursive: true });
  await mkdir(join(home, 'venv', 'bin'), { recursive: true });
  for (const path of [
    'model/config.json',
    'model/model.q8.gguf',
    'model/tokenizer.json',
    'model/README.md',
    'speech-assets.json',
    'voices/selected-voices.jsonl',
    'voices/Easton.safetensors',
    'voices/Zoey.safetensors',
  ]) {
    await writeFile(
      join(home, path),
      path === 'speech-assets.json'
        ? JSON.stringify({
            model_revision: 'cc738b7e4d182c2ba1bafb8062aa4846af000637',
            voice_revision: 'da6c9ec0d47be8df5c87c730a3aa97187f3229c3',
          })
        : 'fixture',
    );
  }
  await writeFile(
    join(home, 'consent.json'),
    JSON.stringify({
      licenseRevision: 'phonon-40m-cc-by-nc-4.0-2026-10-22',
      acceptedAt: new Date().toISOString(),
    }),
  );
  await writeFile(
    join(home, 'install-decision.json'),
    JSON.stringify({
      licenseRevision: 'phonon-40m-cc-by-nc-4.0-2026-10-22',
      decision: 'accepted',
      decidedAt: new Date().toISOString(),
    }),
  );
  const audio = wavBase64();
  await writeFile(
    python,
    `#!/usr/bin/env node
import { appendFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
const audio = ${JSON.stringify(audio)};
process.stdout.write(JSON.stringify({ type: 'ready' }) + '\\n');
createInterface({ input: process.stdin }).on('line', (line) => {
  appendFileSync(${JSON.stringify(log)}, line + '\\n');
  const request = JSON.parse(line);
  process.stdout.write(JSON.stringify({ id: request.id, ok: true, audio }) + '\\n');
});
`,
    { mode: 0o755 },
  );
  return { home, log };
}

async function latestRevision(service) {
  return (await service.execute('campaign_status', {})).revision;
}

async function tableEvent(store, service, operationId, table) {
  await store.transact(
    {
      operationId,
      expectedRevision: await latestRevision(service),
      actor: 'test',
      reason: 'UI narration fixture',
    },
    { ui: 'narration-fixture' },
    () => ({ changes: [], records: [], table }),
  );
}

async function publishFinishedTurn(store, service, id, text) {
  await tableEvent(store, service, `${id}-submit`, {
    type: 'submit',
    id,
    characterId: 'hero',
    text: `Player action for ${id}.`,
  });
  await service.execute('publish_table_message', {
    operationId: `${id}-publish`,
    expectedRevision: await latestRevision(service),
    reason: 'UI narration fixture',
    requestId: id,
    text,
  });
  await tableEvent(store, service, `${id}-finish`, {
    type: 'finish',
    requestId: id,
    status: 'completed',
  });
}

async function speechRequests(path) {
  const content = await readFile(path, 'utf8').catch(() => '');
  return content.trim() ? content.trim().split('\n').map(JSON.parse) : [];
}

async function waitForSpeechRequests(path, count) {
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    const requests = await speechRequests(path);
    if (requests.length >= count) return requests;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.fail(
    `Timed out waiting for ${count} speech requests; saw ${(await speechRequests(path)).length}`,
  );
}

test(
  'Electron narration controls follow campaign state, persist preferences, and play only on request',
  { timeout: 60000 },
  async (t) => {
    const { store, service } = await fixture(t);
    await apply(service, [{ type: 'put_entity', entity: hero }]);
    await store.transact(
      {
        operationId: 'narration-ui-submit',
        expectedRevision: 1,
        actor: 'test',
        reason: 'UI fixture',
      },
      { ui: 'submit' },
      () => ({
        changes: [],
        records: [],
        table: {
          type: 'submit',
          id: 'narration-ui-turn',
          characterId: 'hero',
          text: 'Player action in the old transcript.',
        },
      }),
    );
    await service.execute('publish_table_message', {
      operationId: 'narration-ui-publish-one',
      expectedRevision: await latestRevision(service),
      reason: 'UI fixture',
      requestId: 'narration-ui-turn',
      text: 'The first old DM message waits beside the gate.',
    });
    await service.execute('publish_table_message', {
      operationId: 'narration-ui-publish-two',
      expectedRevision: await latestRevision(service),
      reason: 'UI fixture',
      requestId: 'narration-ui-turn',
      text: 'The second old DM message describes the road beyond.',
    });
    await tableEvent(store, service, 'narration-ui-finish', {
      type: 'finish',
      requestId: 'narration-ui-turn',
      status: 'completed',
    });
    const artifacts = await mkdtemp(join(tmpdir(), 'dm-narration-ui-'));
    const speech = await fakeSpeechHome(artifacts);
    const env = {
      ...process.env,
      DM_DESKTOP_NODE: process.execPath,
      DM_DESKTOP_USER_DATA: join(artifacts, 'profile'),
      DM_SPEECH_HOME: speech.home,
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

    const showCampaign = async (reviewMode) =>
      page.evaluate(
        async ({ root, reviewMode }) => {
          const { showCampaign } = await import('./app.js');
          const snapshot = await window.table.open(root);
          showCampaign(reviewMode ? { ...snapshot, reviewMode } : snapshot);
        },
        { root: store.root, reviewMode },
      );

    await showCampaign('setup');
    await page.locator('#narration-controls').waitFor({ state: 'hidden' });
    assert.equal(await page.locator('#transcript .message-read').count(), 0);

    await showCampaign(undefined);
    await page.locator('#narration-controls').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#narration-voice option').count(), 2);
    assert.deepEqual(
      await page
        .locator('#narration-voice option')
        .evaluateAll((options) => options.map((option) => option.value)),
      ['Easton', 'Zoey'],
    );
    assert.equal(await page.locator('#transcript .message.player .message-read').count(), 0);
    assert.equal(await page.locator('#transcript article:not(.player) .message-read').count(), 2);
    assert.equal(await page.locator('#narration-voice').inputValue(), 'Easton');
    await page.waitForFunction(async () => (await window.table.speechStatus()).available);
    await page.waitForTimeout(150);
    assert.equal(
      await readFile(speech.log, 'utf8').catch(() => ''),
      '',
      'Opening a campaign with historical DM messages must not synthesize speech',
    );

    await page.locator('#narration-voice').selectOption('Zoey');
    await page.waitForFunction(
      () => JSON.parse(localStorage.getItem('dungeon-master.narration.v1')).voice === 'Zoey',
    );
    await page.locator('#narration-voice').selectOption('Easton');
    await page.waitForFunction(
      () => JSON.parse(localStorage.getItem('dungeon-master.narration.v1')).voice === 'Easton',
    );
    await page.locator('#narration-voice').selectOption('Zoey');
    await page.waitForFunction(
      () => JSON.parse(localStorage.getItem('dungeon-master.narration.v1')).voice === 'Zoey',
    );
    await page.locator('#narration-mute').click();
    await page.waitForFunction(
      () => JSON.parse(localStorage.getItem('dungeon-master.narration.v1')).enabled === false,
    );
    assert.equal(await page.locator('#narration-mute').innerText(), 'Enable narration');

    await page.reload();
    await page.waitForSelector('#create-form');
    await showCampaign(undefined);
    await page.locator('#narration-controls').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#narration-voice').inputValue(), 'Zoey');
    assert.equal(await page.locator('#narration-mute').innerText(), 'Enable narration');
    assert.equal(
      await readFile(speech.log, 'utf8').catch(() => ''),
      '',
      'Reloading must keep historical messages silent',
    );

    await page.locator('#transcript .message-read').first().click();
    await page.waitForFunction(() =>
      document.querySelector('#narration-status').textContent.includes('Reading · Zoey'),
    );
    const requests = (await readFile(speech.log, 'utf8')).trim().split('\n').map(JSON.parse);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].voice, 'Zoey');
    await page.locator('#narration-skip').click();
    await page.waitForFunction(
      () => document.querySelector('#narration-status').textContent === 'Automatic narration muted',
    );
    assert.equal(await page.locator('#transcript .message.player .message-read').count(), 0);

    const mutedText = 'A newly published message while muted stays silent.';
    await publishFinishedTurn(store, service, 'narration-ui-muted', mutedText);
    await page.getByText(mutedText, { exact: true }).waitFor();
    assert.equal((await speechRequests(speech.log)).length, 1);

    await page.locator('#narration-mute').click();
    await page.waitForFunction(
      () => JSON.parse(localStorage.getItem('dungeon-master.narration.v1')).enabled === true,
    );
    await page.waitForTimeout(150);
    assert.equal(
      (await speechRequests(speech.log)).length,
      1,
      'Enabling narration must not replay a message observed while muted',
    );

    const autoText = 'A new message after enabling is read automatically.';
    await publishFinishedTurn(store, service, 'narration-ui-auto', autoText);
    await page.getByText(autoText, { exact: true }).waitFor();
    const autoRequests = await waitForSpeechRequests(speech.log, 2);
    assert.equal(autoRequests[1].voice, 'Zoey');
    await page.waitForFunction(() =>
      document.querySelector('#narration-status').textContent.includes('Reading · Zoey'),
    );

    await page.locator('#narration-voice').selectOption('Easton');
    await page.waitForFunction(
      () => JSON.parse(localStorage.getItem('dungeon-master.narration.v1')).voice === 'Easton',
    );
    await page.waitForFunction(() => {
      const status = document.querySelector('#narration-status').textContent;
      return status.includes('Easton') && !status.includes('Reading');
    });
    const autoMessage = page
      .locator('#transcript article:not(.player)')
      .filter({ hasText: autoText });
    await autoMessage.locator('.message-read').click();
    const replayRequests = await waitForSpeechRequests(speech.log, 3);
    assert.equal(replayRequests[2].voice, 'Easton');
    await page.waitForFunction(() =>
      document.querySelector('#narration-status').textContent.includes('Reading · Easton'),
    );
    await page.locator('#narration-skip').click();
    await page.waitForFunction(() =>
      document.querySelector('#narration-status').textContent.includes('Easton'),
    );
    await page.screenshot({ path: '/tmp/dm-narration-controls.png' });
    assert.deepEqual(errors, []);
  },
);
