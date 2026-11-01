import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, record } from './helpers.mjs';
import { DesktopHost } from '../dist/desktop/host.js';

async function createHost(t, campaign) {
  const host = new DesktopHost({ source: process.cwd() });
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

test('speech resolves only exact saved public message text and does not write events', async (t) => {
  const campaign = await fixture(t);
  await configureReview(campaign, 'reviewed');
  const host = await createHost(t, campaign);
  const revision = await publish(
    campaign,
    host,
    '## A sign\n\nThe [sign](https://example.invalid) reads **east.**',
  );
  await record(campaign.service, 'Only the DM sees this private note.', 'dm');
  const before = await campaign.store.events();

  const result = host.speechText({
    campaignId: 'test',
    turnId: 'turn-1',
    revision,
    voice: 'Puck',
    part: 0,
  });
  assert.deepEqual(await result, { text: 'A sign', nextPart: 1 });

  const next = host.speechText({
    campaignId: 'test',
    turnId: 'turn-1',
    revision,
    voice: 'Kore',
    part: 1,
  });
  assert.deepEqual(await next, { text: 'The sign reads east.' });

  await assert.rejects(
    host.speechText({
      campaignId: 'test',
      turnId: 'turn-1',
      revision: revision + 1,
      voice: 'Kore',
      part: 0,
    }),
    /public DM message is unavailable/,
  );
  await assert.rejects(
    host.speechText({
      campaignId: 'test',
      turnId: 'turn-1',
      revision,
      voice: 'Kore',
      part: 0,
      text: 'Synthesize arbitrary text',
    }),
  );
  await assert.rejects(
    host.speechText({
      campaignId: 'test',
      turnId: 'private-scene',
      revision: (await campaign.store.read()).state.revision,
      voice: 'Kore',
      part: 0,
    }),
    /public DM message is unavailable/,
  );
  assert.deepEqual(await campaign.store.events(), before, 'speech does not append campaign events');
});

test('speech rejects setup narration before invoking the runtime', async (t) => {
  const campaign = await fixture(t);
  await configureReview(campaign, 'setup');
  const host = await createHost(t, campaign);
  const revision = await publish(campaign, host, 'What would you like to name the party?');

  await assert.rejects(
    host.speechText({
      campaignId: 'test',
      turnId: 'turn-1',
      revision,
      voice: 'Kore',
      part: 0,
    }),
    /available during play/,
  );
});

test('speech rejects mismatched campaigns and missing chunks', async (t) => {
  const campaign = await fixture(t);
  await configureReview(campaign, 'reviewed');
  const host = await createHost(t, campaign);
  const revision = await publish(campaign, host, 'The gate opens.');
  const input = { campaignId: 'test', turnId: 'turn-1', revision, voice: 'Kore', part: 0 };
  await assert.rejects(host.speechText({ ...input, campaignId: 'other' }), /campaign changed/);
  await assert.rejects(host.speechText({ ...input, part: 42 }), /part is unavailable/);
});
