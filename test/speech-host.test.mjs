import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, record } from './helpers.mjs';
import { DesktopHost } from '../dist/desktop/host.js';

function fakeSpeechRuntime() {
  const calls = [];
  const pending = [];
  return {
    calls,
    pending,
    status: () => ({ available: true, detail: 'Fixture speech runtime' }),
    synthesize(text, voice) {
      calls.push({ text, voice });
      return new Promise((resolve, reject) => pending.push({ resolve, reject }));
    },
    cancel() {},
    close() {},
  };
}

async function createHost(t, campaign, runtime) {
  const host = new DesktopHost({
    source: process.cwd(),
    speechRuntime: runtime,
    speechInstaller: {
      status: async () => ({
        phase: 'ready',
        accepted: true,
        licenseRevision: 'fixture',
        detail: 'Ready',
      }),
    },
  });
  t.after(() => host.close());
  await host.open(campaign.store.root);
  return host;
}

async function configureReview(campaign, mode) {
  const { state } = await campaign.store.read();
  return campaign.service.execute('configure_review', {
    operationId: `configure-${mode}-${state.revision}`,
    expectedRevision: state.revision,
    reason: `Test ${mode} review mode`,
    mode,
  });
}

async function publish(campaign, host, text, turnId = 'turn-1') {
  await host.tableChange({ type: 'submit', id: turnId, text: 'Player action' }, `submit-${turnId}`);
  const result = await campaign.service.execute('publish_table_message', {
    operationId: `publish-${turnId}`,
    expectedRevision: (await campaign.store.read()).state.revision,
    reason: 'Test public narration',
    requestId: turnId,
    text,
  });
  await host.tableChange(
    { type: 'finish', requestId: turnId, status: 'completed' },
    `finish-${turnId}`,
  );
  return result.revision;
}

async function waitFor(predicate) {
  for (let i = 0; i < 100; i++) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.fail('Timed out waiting for speech synthesis to start');
}

test('speech synthesizes only exact saved public message text and does not write events', async (t) => {
  const campaign = await fixture(t);
  const runtime = fakeSpeechRuntime();
  await configureReview(campaign, 'reviewed');
  const host = await createHost(t, campaign, runtime);
  const revision = await publish(
    campaign,
    host,
    '## A sign\n\nThe [sign](https://example.invalid) reads **east.**',
  );
  await record(campaign.service, 'Only the DM sees this private note.', 'dm');
  const before = await campaign.store.events();

  const result = host.speech({
    campaignId: 'test',
    turnId: 'turn-1',
    revision,
    voice: 'Zoey',
    part: 0,
  });
  await waitFor(() => runtime.calls.length === 1);
  assert.deepEqual(runtime.calls, [{ text: 'A sign', voice: 'Zoey' }]);
  runtime.pending[0].resolve('audio-heading');
  assert.deepEqual(await result, { audio: 'audio-heading', nextPart: 1 });

  const next = host.speech({
    campaignId: 'test',
    turnId: 'turn-1',
    revision,
    voice: 'Easton',
    part: 1,
  });
  await waitFor(() => runtime.calls.length === 2);
  assert.deepEqual(runtime.calls[1], { text: 'The sign reads east.', voice: 'Easton' });
  runtime.pending[1].resolve('audio-prose');
  assert.deepEqual(await next, { audio: 'audio-prose' });

  await assert.rejects(
    host.speech({
      campaignId: 'test',
      turnId: 'turn-1',
      revision: revision + 1,
      voice: 'Easton',
      part: 0,
    }),
    /public DM message is unavailable/,
  );
  await assert.rejects(
    host.speech({
      campaignId: 'test',
      turnId: 'turn-1',
      revision,
      voice: 'Easton',
      part: 0,
      text: 'Synthesize arbitrary text',
    }),
  );
  await assert.rejects(
    host.speech({
      campaignId: 'test',
      turnId: 'private-scene',
      revision: (await campaign.store.read()).state.revision,
      voice: 'Easton',
      part: 0,
    }),
    /public DM message is unavailable/,
  );
  assert.equal(runtime.calls.length, 2, 'invalid and private inputs never reach synthesis');
  assert.deepEqual(await campaign.store.events(), before, 'speech does not append campaign events');
});

test('speech rejects setup narration before invoking the runtime', async (t) => {
  const campaign = await fixture(t);
  const runtime = fakeSpeechRuntime();
  await configureReview(campaign, 'setup');
  const host = await createHost(t, campaign, runtime);
  const revision = await publish(campaign, host, 'What would you like to name the party?');

  await assert.rejects(
    host.speech({
      campaignId: 'test',
      turnId: 'turn-1',
      revision,
      voice: 'Easton',
      part: 0,
    }),
    /available during play/,
  );
  assert.deepEqual(runtime.calls, []);
});

test('installed speech cannot synthesize without current license acceptance', async (t) => {
  const campaign = await fixture(t);
  const runtime = fakeSpeechRuntime();
  const host = new DesktopHost({
    source: process.cwd(),
    speechRuntime: runtime,
    speechInstaller: {
      status: async () => ({
        phase: 'declined',
        accepted: false,
        licenseRevision: 'fixture',
        detail: 'Declined',
      }),
    },
  });
  t.after(() => host.close());
  await host.open(campaign.store.root);
  const revision = await publish(campaign, host, 'The gate opens.');
  assert.equal((await host.speechStatus()).available, false);
  await assert.rejects(
    host.speech({ campaignId: 'test', turnId: 'turn-1', revision, voice: 'Easton', part: 0 }),
    /Set up optional narration/,
  );
  assert.equal(runtime.calls.length, 0);
});

test('cancellation and switching campaigns reject stale synthesis results', async (t) => {
  const first = await fixture(t);
  await configureReview(first, 'reviewed');
  const second = await fixture(t);
  const runtime = fakeSpeechRuntime();
  const host = await createHost(t, first, runtime);
  const revision = await publish(first, host, 'The old road bends north.');

  const canceled = host.speech({
    campaignId: 'test',
    turnId: 'turn-1',
    revision,
    voice: 'Easton',
    part: 0,
  });
  await waitFor(() => runtime.pending.length === 1);
  await host.cancelSpeech();
  runtime.pending[0].resolve('cancelled-audio');
  await assert.rejects(canceled, /Reading cancelled/);

  const switched = host.speech({
    campaignId: 'test',
    turnId: 'turn-1',
    revision,
    voice: 'Zoey',
    part: 0,
  });
  await waitFor(() => runtime.pending.length === 2);
  await host.open(second.store.root);
  runtime.pending[1].resolve('stale-audio');
  await assert.rejects(switched, /Reading cancelled/);
  assert.equal(runtime.calls.length, 2);
});
