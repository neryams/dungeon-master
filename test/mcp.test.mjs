import test from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { resolve } from 'node:path';
import { fixture, hero, apply } from './helpers.mjs';
import { createMcpServer } from '../dist/server.js';
import { MapEdge } from '../dist/schema.js';

test('MCP exposes only domain tools, validates input and reports revision conflicts', async (t) => {
  const { service } = await fixture(t);
  const server = createMcpServer(service),
    client = new Client({ name: 'test', version: '1' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a);
  await client.connect(b);
  t.after(async () => {
    await client.close();
    await server.close();
  });
  const advertised = (await client.listTools()).tools;
  // MCP hosts validating against JSON Schema 2020-12 reject draft-07 tuple items.
  function checkItems(schema) {
    if (!schema || typeof schema !== 'object') return;
    if (!Array.isArray(schema)) assert.ok(!Array.isArray(schema.items), 'array-valued items');
    for (const value of Object.values(schema)) checkItems(value);
  }
  for (const tool of advertised) checkItems(tool.inputSchema);
  assert.deepEqual(MapEdge.parse(['from', 'to']), ['from', 'to']);
  for (const edge of [[], ['from'], ['from', 'to', 'extra'], ['from', '../invalid']])
    assert.equal(MapEdge.safeParse(edge).success, false);
  const tools = advertised.map((t) => t.name);
  assert.equal(tools.length, 31);
  assert.ok(!tools.includes('write_entry'));
  assert.ok(!tools.includes('search_journal'));
  const result = await client.callTool({
    name: 'apply_campaign_changes',
    arguments: {
      operationId: 'create',
      expectedRevision: 0,
      reason: 'Create hero',
      changes: [{ type: 'put_entity', entity: hero }],
    },
  });
  assert.ok(!result.isError);
  const conflict = await client.callTool({
    name: 'apply_campaign_changes',
    arguments: {
      operationId: 'stale',
      expectedRevision: 0,
      reason: 'Create hero',
      changes: [{ type: 'put_entity', entity: hero }],
    },
  });
  assert.equal(conflict.isError, true);
  assert.match(conflict.content[0].text, /REVISION_CONFLICT/);
  const invalid = await client.callTool({
    name: 'get_campaign_entity',
    arguments: { id: '../../secret' },
  });
  assert.equal(invalid.isError, true);
  const rules = await client.callTool({ name: 'read_rules', arguments: { page: 6 } });
  assert.equal(rules.structuredContent.source.id, 'srd-5.2.1');
  const toc = await client.callTool({ name: 'list_rule_sections', arguments: { limit: 2 } });
  assert.equal(toc.structuredContent.sections.length, 2);
  const sectionSearch = await client.callTool({
    name: 'search_rules',
    arguments: { query: 'Long Jump' },
  });
  const section = await client.callTool({
    name: 'read_rules',
    arguments: { sectionId: sectionSearch.structuredContent.hits[0].id },
  });
  assert.match(section.structuredContent.text, /Strength score/);
  const policy = await client.callTool({
    name: 'configure_review',
    arguments: {
      operationId: 'policy',
      expectedRevision: 1,
      reason: 'Enable referee',
      mode: 'reviewed',
    },
  });
  assert.ok(!policy.isError);
  const prepared = await client.callTool({
    name: 'prepare_action',
    arguments: {
      operationId: 'prepare',
      expectedRevision: 2,
      reason: 'Review an action',
      actionId: 'action',
      actors: ['hero'],
      intent: 'Inspect a door',
      circumstances: 'A visible ordinary door',
    },
  });
  assert.ok(!prepared.isError);
  const action = await client.callTool({ name: 'get_action', arguments: { actionId: 'action' } });
  assert.equal(action.structuredContent.status, 'prepared');
});
test('a fresh stdio process resumes exact saved state without prior chat', async (t) => {
  const { store, service } = await fixture(t);
  await apply(service, [
    { type: 'put_entity', entity: hero },
    { type: 'set_session', session: 's1' },
    {
      type: 'set_scene',
      scene: {
        id: 'door',
        title: 'Locked door',
        present: ['hero'],
        unresolved: ['Pick the lock?'],
      },
    },
  ]);
  async function readFromNewProcess() {
    const client = new Client({ name: 'fresh-chat', version: '1' }),
      transport = new StdioClientTransport({
        command: process.execPath,
        args: [resolve('dist/server.js'), '--campaign', store.root],
        stderr: 'pipe',
      });
    transport.stderr?.on('data', () => {});
    try {
      await client.connect(transport);
      const reply = await client.callTool({
        name: 'resume_campaign',
        arguments: { audience: 'party' },
      });
      assert.ok(!reply.isError);
      return JSON.parse(reply.content[0].text);
    } finally {
      await client.close();
      await transport.close();
    }
  }
  const first = await readFromNewProcess(),
    second = await readFromNewProcess();
  assert.deepEqual(first, second);
  assert.equal(first.entities[0].character.hp, 10);
  assert.equal(first.scene.unresolved[0], 'Pick the lock?');
});
