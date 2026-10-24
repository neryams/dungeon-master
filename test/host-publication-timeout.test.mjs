import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fixture, apply, hero } from './helpers.mjs';
import { DesktopHost } from '../dist/desktop/host.js';
import { AgentTimeoutError } from '../dist/desktop/turn-deadline.js';

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
    assert.equal(
      view.table[0].status,
      scenario === 'response-timeout' ? 'completed' : 'interrupted',
    );
    assert.equal(view.table[0].messages.length, 1);
    if (scenario === 'response-timeout') {
      assert.match(view.detail, /Response saved; follow-up work timed out/);
      assert.equal((await store.read()).state.gathering.request.prompt, 'Wait or speak?');
    }
    assert.equal((await host.submit({ id: 'turn', text: 'Approach' })).duplicate, true);
    assert.equal(runs, 1);
    await host.close();
  });
}
