import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fixture, apply, hero } from './helpers.mjs';
import { DesktopHost } from '../dist/desktop/host.js';

test(
  'desktop MCP waits for player faces and recovers the same committed result on tool retry',
  { timeout: 15000 },
  async (t) => {
    const { store, service } = await fixture(t);
    await apply(service, [
      { type: 'put_entity', entity: hero },
      { type: 'set_party', members: ['hero'] },
    ]);
    const host = new DesktopHost({ source: resolve('.') });
    t.after(() => host.close());
    await host.open(store.root);
    const owner = JSON.parse(await readFile(join(store.root, '.dm/hotseat/owner.json'), 'utf8'));
    const client = new Client({ name: 'player-roll-test', version: '1' });
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [resolve('dist/desktop/server.js'), '--campaign', store.root],
      env: { ...process.env, DM_HOTSEAT_OWNER_TOKEN: owner.token },
      stderr: 'pipe',
    });
    transport.stderr?.on('data', () => {});
    t.after(async () => {
      await client.close();
      await transport.close();
    });
    await client.connect(transport);
    const input = {
      operationId: randomUUID(),
      expectedRevision: (await store.read()).state.revision,
      reason: 'Player perception',
      characterId: 'hero',
      expression: '1d20+3',
      purpose: 'Perception check',
    };
    let resolved = false;
    const call = client.callTool({ name: 'roll_dice', arguments: input }).then((r) => {
      resolved = true;
      return r;
    });
    let snapshot;
    for (let i = 0; i < 100; i++) {
      snapshot = await host.snapshot();
      if (snapshot.pendingRolls?.length) break;
      await delay(25);
    }
    assert.equal(snapshot.pendingRolls.length, 1);
    assert.equal(resolved, false);
    assert.equal(snapshot.rollHistory.length, 0);
    assert.equal(
      snapshot.activity?.rolls.some((r) => r.status === 'rolling'),
      false,
      'waiting for player input must not animate a roll',
    );
    const prompt = snapshot.pendingRolls[0];
    assert.equal(prompt.characterId, 'hero');
    assert.equal(prompt.label, 'Perception Check');
    await host.submitRoll({ id: prompt.id, dice: [14] });
    const result = await call;
    assert.equal(result.isError, undefined);
    assert.equal(result.structuredContent.roll.total, 17);
    assert.deepEqual(result.structuredContent.roll.dice, [14]);
    const retry = await client.callTool({ name: 'roll_dice', arguments: input });
    assert.equal(retry.isError, undefined);
    assert.deepEqual(retry.structuredContent.roll, result.structuredContent.roll);
    const after = await host.snapshot();
    assert.equal(after.pendingRolls.length, 0);
    assert.equal(after.rollHistory.length, 1);
    assert.equal(after.rollHistory[0].source, 'physical');
    assert.equal(after.rollHistory[0].total, 17);
  },
);
