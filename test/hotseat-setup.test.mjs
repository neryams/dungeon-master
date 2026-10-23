import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { setTimeout as delay } from 'node:timers/promises';
import { fixture, apply, hero } from './helpers.mjs';
import { CampaignStore } from '../dist/store.js';
import { DesktopHost } from '../dist/desktop/host.js';

async function waitFor(host, predicate) {
  // Setup includes filesystem transactions and PNG rendering, competing with the full suite in CI.
  const deadline = performance.now() + 10_000;
  let snapshot;
  do {
    snapshot = await host.snapshot();
    if (predicate(snapshot)) return snapshot;
    assert.notEqual(snapshot.stage, 'attention', snapshot.detail);
    await delay(25);
  } while (performance.now() < deadline);
  assert.fail(
    `Timed out waiting for the desktop host state: ${snapshot.stage}: ${snapshot.detail}`,
  );
}

function testHost(store, parent, driver) {
  return new DesktopHost({
    source: resolve('.'),
    permissionPath: `${parent}/settings.json`,
    probe: async () => ({ path: process.execPath, version: 'fixture' }),
    driver,
  });
}

async function setReviewMode(store, service, mode) {
  const { state } = await store.read();
  await service.execute('configure_review', {
    operationId: `prepare-${mode}`,
    expectedRevision: state.revision,
    reason: `Prepare ${mode} campaign for setup test`,
    mode,
  });
}

test('beginSetup submits one durable onboarding turn and carries setup-only guidance', async (t) => {
  const { store, service, parent } = await fixture(t);
  await setReviewMode(store, service, 'setup');
  await apply(service, [{ type: 'put_entity', entity: hero }]);
  const prompts = [];
  const host = testHost(store, parent, () => ({
    run: async (prompt) => {
      prompts.push(prompt);
      if (prompt.startsWith('Connection check'))
        return { tools: ['campaign_status'], campaignIds: ['test'] };
      const current = JSON.parse(prompt.match(/Current player submission: (\{.*\})$/s)[1]);
      const { state } = await store.read();
      await service.execute('publish_table_message', {
        operationId: `test-publish-${current.requestId}`,
        expectedRevision: state.revision,
        reason: 'Publish setup question',
        requestId: current.requestId,
        text: 'Would you like to share a specific premise, build from a vague idea, or be surprised?',
      });
      return { tools: ['publish_table_message'], campaignIds: ['test'] };
    },
    close: async () => {},
  }));
  t.after(() => host.close());
  await host.open(store.root);
  await assert.rejects(host.beginSetup(), /Connect the DM/);
  await assert.rejects(host.startLan(), /Finish campaign setup/);
  assert.equal((await store.read()).state.table, undefined);
  await host.connect();

  await Promise.all([host.beginSetup(), host.beginSetup()]);
  await waitFor(host, (snapshot) => snapshot.stage === 'ready');
  await host.beginSetup();

  const setupPrompt = prompts.find((prompt) => prompt.includes('Current player submission:'));
  assert.equal(prompts.filter((prompt) => prompt.includes('Current player submission:')).length, 1);
  assert.equal((await store.read()).state.table[0].id, 'desktop-campaign-setup');
  assert.match(setupPrompt, /Campaign setup contract/);
  assert.match(setupPrompt, /one or two focused questions per turn/);
  assert.match(setupPrompt, /readable rendered starting map/);
  assert.match(setupPrompt, /do not start actual gameplay/);
});

test('an interrupted setup is never replayed after reopen; an explicit follow-up can finish setup', async (t) => {
  const { store, service, parent } = await fixture(t);
  await setReviewMode(store, service, 'setup');
  const example = JSON.parse(await readFile('examples/lantern-ford.json', 'utf8'));
  const prompts = [];
  let failFirstSetup = true;
  let host;
  const driver = () => ({
    run: async (prompt) => {
      prompts.push(prompt);
      if (prompt.startsWith('Connection check'))
        return { tools: ['campaign_status'], campaignIds: ['test'] };
      const current = JSON.parse(prompt.match(/Current player submission: (\{.*\})$/s)[1]);
      if (current.requestId === 'desktop-campaign-setup' && failFirstSetup) {
        failFirstSetup = false;
        throw new Error('synthetic interruption');
      }
      await apply(service, example.changes);
      let { state } = await store.read();
      await service.execute('create_location_map', {
        operationId: `test-map-${current.requestId}`,
        expectedRevision: state.revision,
        reason: 'Create and verify the starting map',
        entity: example.bridgeMap,
      });
      ({ state } = await store.read());
      const rendered = await host.map({ mapId: example.bridgeMap.id, revision: state.revision });
      assert.match(rendered.image, /^data:image\/png;base64,/);
      await service.execute('configure_review', {
        operationId: `test-review-${current.requestId}`,
        expectedRevision: state.revision,
        reason: 'Verify the saved party, quest, focus, scene, and rendered map',
        mode: 'reviewed',
      });
      ({ state } = await store.read());
      await service.execute('publish_table_message', {
        operationId: `test-publish-${current.requestId}`,
        expectedRevision: state.revision,
        reason: 'Publish completed opening',
        requestId: current.requestId,
        text: 'The party and starting place are ready. The first decision is yours.',
      });
      return {
        tools: ['apply_campaign_changes', 'configure_review', 'publish_table_message'],
        campaignIds: ['test'],
      };
    },
    close: async () => {},
  });

  host = testHost(store, parent, driver);
  t.after(() => host.close());
  await host.open(store.root);
  await host.connect();
  await host.beginSetup();
  await waitFor(host, (snapshot) => snapshot.stage === 'attention');
  assert.equal((await store.read()).state.table[0].status, 'interrupted');
  await host.close();

  host = testHost(store, parent, driver);
  await host.open(store.root);
  await host.connect();
  await host.beginSetup();
  assert.equal(prompts.filter((prompt) => prompt.includes('Current player submission:')).length, 1);
  assert.equal((await store.read()).state.table[0].status, 'interrupted');

  await host.submit({
    id: 'setup-follow-up',
    text: 'Generate a small party and decide the premise for me.',
  });
  const finished = await waitFor(host, (snapshot) => snapshot.stage === 'ready');
  assert.equal(finished.reviewMode, 'reviewed');
  assert.deepEqual(
    finished.party.members.map((member) => member.id),
    ['mara', 'tess'],
  );
  assert.equal(finished.table[1].id, 'setup-follow-up');
  assert.equal(finished.table[1].status, 'completed');
  assert.equal(prompts.filter((prompt) => prompt.includes('Current player submission:')).length, 2);
});

test('beginSetup is a no-op for legacy and already reviewed campaigns', async (t) => {
  for (const mode of ['legacy', 'reviewed']) {
    const { store, service, parent } = await fixture(t);
    await setReviewMode(store, service, mode);
    const host = testHost(store, parent, () => {
      throw new Error('A non-setup campaign must not start a setup turn');
    });
    t.after(() => host.close());
    await host.open(store.root);
    await host.beginSetup();
    assert.deepEqual((await store.read()).state.table ?? [], []);
  }
});

test('a pending setup check for an old campaign does not suppress the newly opened campaign', async (t) => {
  const first = await fixture(t);
  const second = await fixture(t);
  await setReviewMode(first.store, first.service, 'setup');
  await setReviewMode(second.store, second.service, 'setup');

  const originalRead = CampaignStore.prototype.read;
  let enteredRead;
  const blockedRead = new Promise((resolve) => {
    enteredRead = resolve;
  });
  let releaseRead;
  const readGate = new Promise((resolve) => {
    releaseRead = resolve;
  });
  let enteredSecondRead;
  const blockedSecondRead = new Promise((resolve) => {
    enteredSecondRead = resolve;
  });
  let releaseSecondRead;
  const secondReadGate = new Promise((resolve) => {
    releaseSecondRead = resolve;
  });
  let shouldBlockFirst = false;
  let shouldBlockSecond = false;
  CampaignStore.prototype.read = async function (...args) {
    if (this.root === first.store.root && shouldBlockFirst) {
      shouldBlockFirst = false;
      enteredRead();
      await readGate;
    }
    if (this.root === second.store.root && shouldBlockSecond) {
      shouldBlockSecond = false;
      enteredSecondRead();
      await secondReadGate;
    }
    return originalRead.apply(this, args);
  };
  t.after(() => {
    CampaignStore.prototype.read = originalRead;
  });

  const host = testHost(first.store, first.parent, () => ({
    run: async () => ({ tools: ['campaign_status'], campaignIds: ['test'] }),
    close: async () => {},
  }));
  t.after(() => host.close());
  await host.open(first.store.root);
  await host.connect();
  shouldBlockFirst = true;
  const oldCheck = host.beginSetup();
  await blockedRead;

  await host.open(second.store.root);
  await host.connect();
  shouldBlockSecond = true;
  const newCheck = host.beginSetup();
  await blockedSecondRead;

  releaseRead();
  await oldCheck;
  assert.strictEqual(host.beginSetup(), newCheck);
  releaseSecondRead();
  await newCheck;
  assert.equal((await second.store.read()).state.table?.[0]?.id, 'desktop-campaign-setup');
  await waitFor(host, (snapshot) => snapshot.stage === 'attention');
  assert.equal((await first.store.read()).state.table, undefined);
  await host.close();
});
