import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, stat, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { appendPerformanceRecord } from '../dist/desktop/performance.js';

test('performance log keeps bounded timing metadata private and outside gameplay', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'dm-performance-'));
  t.after(async () => rm(root, { recursive: true, force: true }));
  await appendPerformanceRecord(root, {
    kind: 'backend-tool',
    requestId: 'request-123',
    provider: 'codex',
    model: 'gpt-6-sol',
    tool: 'apply_campaign_changes',
    callId: 'call-42',
    elapsedMs: 39,
    status: 'ok',
    prompt: 'PRIVATE PROMPT',
    args: { secret: 'PRIVATE ARGUMENT' },
    result: 'PRIVATE RESULT',
  });
  const path = join(root, '.dm/hotseat/performance.jsonl');
  const line = JSON.parse(await readFile(path, 'utf8'));
  assert.deepEqual(line, {
    kind: 'backend-tool',
    at: line.at,
    requestId: 'request-123',
    provider: 'codex',
    model: 'gpt-6-sol',
    tool: 'apply_campaign_changes',
    callId: 'call-42',
    elapsedMs: 39,
    status: 'ok',
  });
  assert.equal((await stat(path)).mode & 0o777, 0o600);
  assert.doesNotMatch(await readFile(path, 'utf8'), /PRIVATE/);

  await appendPerformanceRecord(root, { kind: 'request-complete', requestId: 'x' });
  assert.deepEqual((await readdir(join(root, '.dm/hotseat'))).sort(), [
    '.performance.jsonl.lockdir',
    'performance.jsonl',
  ]);
});

test('performance logging failures never escape into gameplay', async () => {
  await assert.doesNotReject(
    appendPerformanceRecord('/path/that/does/not/exist/inside/root', {
      kind: 'request-interrupted',
      status: 'interrupted',
    }),
  );
});

test('performance rotation stays bounded with concurrent writes and refuses symlinks', async (t) => {
  const { writeFile, symlink } = await import('node:fs/promises');
  const root = await mkdtemp(join(tmpdir(), 'dm-performance-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await appendPerformanceRecord(root, { kind: 'request-start' });
  const path = join(root, '.dm/hotseat/performance.jsonl');
  await writeFile(path, 'x'.repeat(1024 * 1024));
  await Promise.all(
    Array.from({ length: 20 }, (_, i) =>
      appendPerformanceRecord(root, {
        kind: 'backend-tool',
        tool: 'commit_action',
        callId: `call-${i}`,
        elapsedMs: i,
      }),
    ),
  );
  const rows = (await readFile(path, 'utf8')).trim().split('\n').map(JSON.parse);
  assert.equal(rows.length, 20);
  assert.equal(new Set(rows.map((row) => row.callId)).size, 20);
  assert.equal((await stat(path + '.1')).size, 1024 * 1024);
  assert((await stat(path)).size < 1024 * 1024);
  const target = join(root, 'untouched');
  await writeFile(target, 'original');
  await rm(path);
  await symlink(target, path);
  await appendPerformanceRecord(root, { kind: 'request-complete' });
  assert.equal(await readFile(target, 'utf8'), 'original');
});

test('desktop backend correlates successful, failed and publication timings without payloads', async (t) => {
  const { writeFile } = await import('node:fs/promises');
  const { resolve } = await import('node:path');
  const { setTimeout: delay } = await import('node:timers/promises');
  const { fixture } = await import('./helpers.mjs');
  const { DesktopHost } = await import('../dist/desktop/host.js');
  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
  const { StdioClientTransport } = await import('@modelcontextprotocol/sdk/client/stdio.js');
  const { store } = await fixture(t);
  const host = new DesktopHost({ source: resolve('.') });
  await host.open(store.root);
  t.after(() => host.close());
  const ownerPath = join(store.root, '.dm/hotseat/owner.json');
  const owner = JSON.parse(await readFile(ownerPath, 'utf8'));
  await writeFile(ownerPath, JSON.stringify({ ...owner, activeRequestId: 'timing-test' }));
  await store.transact(
    { operationId: 'submit', expectedRevision: 0, actor: 'test', reason: 'test' },
    {},
    () => ({
      changes: [],
      records: [],
      table: { type: 'submit', id: 'timing-test', text: 'PRIVATE_INPUT' },
    }),
  );
  const client = new Client({ name: 'timing-test', version: '1' });
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
  await client.callTool({ name: 'get_party_overview', arguments: {} });
  assert.equal(
    (await client.callTool({ name: 'get_campaign_entity', arguments: { id: 'missing' } })).isError,
    true,
  );
  await client.callTool({
    name: 'publish_table_message',
    arguments: {
      operationId: 'publish',
      expectedRevision: 1,
      reason: 'PRIVATE_REASON',
      requestId: 'timing-test',
      text: 'PRIVATE_PROSE',
    },
  });
  let rows = [];
  for (let i = 0; i < 100; i++) {
    rows = (
      await readFile(join(store.root, '.dm/hotseat/performance-backend.jsonl'), 'utf8').catch(
        () => '',
      )
    )
      .trim()
      .split('\n')
      .filter(Boolean)
      .map(JSON.parse);
    if (rows.length >= 4) break;
    await delay(10);
  }
  assert.equal(rows.length, 4);
  assert(rows.every((row) => row.requestId === 'timing-test'));
  assert.equal(rows.find((row) => row.tool === 'get_campaign_entity').status, 'error');
  assert.equal(rows.find((row) => row.tool === 'publish_table_message').status, 'ok');
  assert.equal(rows.filter((row) => row.kind === 'first-publication').length, 1);
  assert(rows.filter((row) => row.kind === 'backend-tool').every((row) => row.elapsedMs >= 0));
  assert.doesNotMatch(JSON.stringify(rows), /PRIVATE_/);
});
