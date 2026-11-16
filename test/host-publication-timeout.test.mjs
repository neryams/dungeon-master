import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fixture, apply, hero } from './helpers.mjs';
import { DesktopHost } from '../dist/desktop/host.js';
import { AgentTimeoutError, TurnDeadline } from '../dist/desktop/turn-deadline.js';
import { requestPlayerRoll } from '../dist/desktop/player-roll.js';

for (const scenario of [
  'response-timeout',
  'progress-timeout',
  'response-error',
  'progress-success',
]) {
  test(`host preserves publication semantics: ${scenario}`, async (t) => {
    const { store, service, parent } = await fixture(t);
    await apply(service, [{ type: 'put_entity', entity: hero }]);
    let runs = 0;
    const final = scenario.startsWith('response');
    const host = new DesktopHost({
      source: resolve('.'),
      permissionPath: join(parent, 'settings.json'),
      probe: async () => ({ path: process.execPath, version: 'fixture' }),
      driver: (options) => ({
        run: async (_prompt, requestId) => {
          if (!requestId) return { tools: ['campaign_status'], campaignIds: ['test'] };
          runs++;
          assert.equal(await options.hasPublishedResponse(requestId), false);
          await service.execute('publish_table_message', {
            operationId: 'publish',
            expectedRevision: (await store.read()).state.revision,
            reason: 'Public narration',
            requestId,
            text: 'The guard approaches.',
            delivery: final ? 'response' : 'progress',
            ...(final
              ? {
                  responseRequest: {
                    characterIds: ['hero'],
                    prompt: 'Wait or speak?',
                    kind: 'decision',
                  },
                }
              : {}),
          });
          assert.equal(await options.hasPublishedResponse(requestId), final);
          if (scenario.endsWith('timeout')) throw new AgentTimeoutError('Timed out');
          if (scenario.endsWith('error')) throw new Error('Provider disconnected');
          return { tools: ['publish_table_message'], campaignIds: ['test'] };
        },
        close: async () => {},
      }),
    });
    t.after(() => host.close());
    await host.open(store.root);
    await host.connect();
    await host.submit({ id: 'turn', text: 'Approach' });
    const deadline = Date.now() + 10000;
    let view;
    do {
      view = await host.snapshot();
      if (view.stage === 'attention') break;
      await delay(10);
    } while (Date.now() < deadline);
    assert.equal(view.stage, 'attention');
    assert.equal(view.table[0].status, final ? 'completed' : 'interrupted');
    assert.equal(view.table[0].messages.length, 1);
    if (final) {
      assert.match(
        view.detail,
        scenario === 'response-timeout'
          ? /Response saved; follow-up work timed out/
          : /Response saved; follow-up work was interrupted/,
      );
      assert.equal((await store.read()).state.gathering.request.prompt, 'Wait or speak?');
    }
    assert.equal((await host.submit({ id: 'turn', text: 'Approach' })).duplicate, true);
    assert.equal(runs, 1);
    await host.close();
  });
}

test('Antigravity connect falls back to a fresh conversation when resuming a saved session fails', async (t) => {
  const { store, parent } = await fixture(t);
  const seen = [];
  const host = new DesktopHost({
    source: resolve('.'),
    permissionPath: join(parent, 'settings.json'),
    probe: async () => ({ path: process.execPath, version: 'fixture' }),
    driver: (options) => ({
      run: async () => {
        seen.push(options.conversationId);
        if (options.conversationId === 'poisoned-conv')
          throw new Error('Antigravity did not complete the turn.');
        await options.onConversation('fresh-conv');
        return { tools: ['campaign_status'], campaignIds: ['test'] };
      },
      close: async () => {},
    }),
  });
  t.after(() => host.close());
  await host.open(store.root);
  const { writeFile, readFile } = await import('node:fs/promises');
  await writeFile(
    join(store.root, '.dm/hotseat/session.json'),
    JSON.stringify({
      campaignRoot: store.root,
      provider: 'antigravity',
      conversationId: 'poisoned-conv',
    }),
  );
  await host.connect();
  assert.deepEqual(seen, ['poisoned-conv', undefined]);
  const saved = JSON.parse(await readFile(join(store.root, '.dm/hotseat/session.json'), 'utf8'));
  assert.equal(saved.conversationId, 'fresh-conv');
});

test('mid-turn player roll wait time in DesktopHost extends TurnDeadline rather than consuming DM compute budget', async (t) => {
  const { store, service, parent } = await fixture(t);
  await apply(service, [{ type: 'put_entity', entity: hero }]);
  let timedOut = false;
  let measuredRollWaitMs = 0;
  const host = new DesktopHost({
    source: resolve('.'),
    permissionPath: join(parent, 'settings.json'),
    probe: async () => ({ path: process.execPath, version: 'fixture' }),
    driver: (options) => ({
      run: async (_prompt, requestId) => {
        if (!requestId) return { tools: ['campaign_status'], campaignIds: ['test'] };
        const deadline = new TurnDeadline({
          timeoutMs: 400,
          pollIntervalMs: 15,
          requestId,
          hasPublishedResponse: options.hasPublishedResponse,
          isAwaitingPlayerRoll: options.isAwaitingPlayerRoll,
          playerRollWaitMs: options.playerRollWaitMs,
          onTimeout: () => {
            timedOut = true;
          },
        });
        deadline.start();
        try {
          // Two sequential mid-turn player rolls taking ~260ms each (~520ms total wait > 400ms timeoutMs).
          for (const opId of ['mid-roll-1', 'mid-roll-2']) {
            const req = await requestPlayerRoll(store, {
              operationId: opId,
              expectedRevision: (await store.read()).state.revision,
              reason: 'Attack check',
              characterId: 'hero',
              expression: '1d20+5',
              purpose: 'Attack',
            });
            await delay(260);
            await host.submitRoll({ id: req.id, dice: [14] });
          }
          measuredRollWaitMs = await options.playerRollWaitMs(requestId);
          // Total wall-clock is now >550ms (>400ms timeoutMs), but DM compute is well under 400ms.
          await delay(30);
          assert.equal(timedOut, false, 'TurnDeadline must not expire from mid-turn player roll wait');
          await service.execute('publish_table_message', {
            operationId: 'publish-after-rolls',
            expectedRevision: (await store.read()).state.revision,
            reason: 'Public narration',
            requestId,
            text: 'Your strikes land true.',
            delivery: 'response',
          });
          return { tools: ['publish_table_message'], campaignIds: ['test'] };
        } finally {
          deadline.cancel();
        }
      },
      close: async () => {},
    }),
  });
  t.after(() => host.close());
  await host.open(store.root);
  await host.connect();
  await host.submit({ id: 'roll-budget-turn', characterId: 'hero', text: 'I attack twice.' });
  const waitUntil = Date.now() + 10000;
  let view;
  do {
    view = await host.snapshot();
    if (view.stage === 'ready' || view.stage === 'attention') break;
    await delay(10);
  } while (Date.now() < waitUntil);
  assert.equal(view.stage, 'ready');
  assert.equal(timedOut, false);
  assert.ok(measuredRollWaitMs >= 480, `Expected >=480ms credited roll wait, got ${measuredRollWaitMs}`);
  assert.equal(view.table[0].status, 'completed');
});

test('DesktopHost.resume transitions an interrupted turn back to pending, preserves progress messages, and passes explicit resume instructions', async (t) => {
  const { store, service, parent } = await fixture(t);
  await apply(service, [{ type: 'put_entity', entity: hero }]);
  const prompts = [];
  let attempt = 0;
  const host = new DesktopHost({
    source: resolve('.'),
    permissionPath: join(parent, 'settings.json'),
    probe: async () => ({ path: process.execPath, version: 'fixture' }),
    driver: () => ({
      run: async (prompt, requestId) => {
        if (!requestId) return { tools: ['campaign_status'], campaignIds: ['test'] };
        attempt++;
        prompts.push(prompt);
        if (attempt === 1) {
          await service.execute('publish_table_message', {
            operationId: 'progress-beat-1',
            expectedRevision: (await store.read()).state.revision,
            reason: 'Mid-turn progress beat',
            requestId,
            text: 'Bram vaults over the barricade.',
            delivery: 'progress',
          });
          throw new AgentTimeoutError('Antigravity');
        }
        await service.execute('publish_table_message', {
          operationId: 'final-response-1',
          expectedRevision: (await store.read()).state.revision,
          reason: 'Completed turn response',
          requestId,
          text: 'The scouts scatter into the mist; what do you do next?',
          delivery: 'response',
        });
        return { tools: ['publish_table_message'], campaignIds: ['test'] };
      },
      close: async () => {},
    }),
  });
  t.after(() => host.close());
  await host.open(store.root);
  await host.connect();
  await host.submit({ id: 'interrupted-turn', characterId: 'hero', text: 'Charge the barricade' });

  const waitAttention = Date.now() + 10000;
  let view;
  do {
    view = await host.snapshot();
    if (view.stage === 'attention') break;
    await delay(10);
  } while (Date.now() < waitAttention);
  assert.equal(view.stage, 'attention');
  assert.equal(view.table.length, 1);
  assert.equal(view.table[0].id, 'interrupted-turn');
  assert.equal(view.table[0].status, 'interrupted');
  assert.equal(view.table[0].messages.length, 1);
  assert.equal(view.table[0].messages[0].delivery, 'progress');

  // Resume directly from attention stage (auto-reconnects and resumes in place without a new user message).
  const resumed = await host.resume('interrupted-turn');
  assert.deepEqual(resumed, { id: 'interrupted-turn', duplicate: false });

  const waitReady = Date.now() + 10000;
  do {
    view = await host.snapshot();
    if (view.stage === 'ready' || view.stage === 'attention') break;
    await delay(10);
  } while (Date.now() < waitReady);
  assert.equal(view.stage, 'ready');
  assert.equal(view.table.length, 1, 'Resume must not add a second table turn');
  assert.equal(view.table[0].id, 'interrupted-turn');
  assert.equal(view.table[0].status, 'completed');
  assert.equal(view.table[0].messages.length, 2, 'Progress beat and final response are both preserved');
  assert.equal(view.table[0].messages[0].delivery, 'progress');
  assert.equal(view.table[0].messages[1].delivery, 'response');

  assert.equal(prompts.length, 2);
  assert.doesNotMatch(prompts[0], /Resumed turn contract:/);
  assert.match(prompts[1], /Resumed turn contract: You are resuming interrupted request "interrupted-turn"/);
  assert.match(prompts[1], /resume_campaign/);
  assert.match(prompts[1], /pendingActions/);
  assert.match(prompts[1], /Do NOT repeat already-committed actions \(commit_action\) or re-roll already-saved dice/);
  assert.match(prompts[1], /publish_table_message\(delivery="response", requestId="interrupted-turn"\)/);
});
