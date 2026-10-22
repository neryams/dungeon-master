import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { LocalSettings, dispatchWorker, dispatchDesktop } from '../dist/desktop/contracts.js';
import {
  validateLocalModel,
  localModels,
  suggestModels,
  localModelCatalog,
} from '../dist/desktop/local.js';
import { LocalMemoryGuard } from '../dist/desktop/memory.js';
import { fixture, record, apply, hero } from './helpers.mjs';

async function ollama(t, info) {
  const routes = [];
  const server = createServer((req, res) => {
    routes.push(req.url);
    res.setHeader('Content-Type', 'application/json');
    res.end(
      JSON.stringify(
        req.url === '/api/tags'
          ? { models: [{ name: 'custom:vision', size: 6 * 1024 ** 3 }] }
          : info,
      ),
    );
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => new Promise((r) => server.close(r)));
  return {
    settings: {
      endpoint: `http://127.0.0.1:${server.address().port}`,
      model: 'custom:vision',
      contextTokens: 32768,
    },
    routes,
  };
}
const capable = {
  capabilities: ['completion', 'vision', 'tools'],
  model_info: { 'custom.context_length': 131072 },
};
test('local metadata accepts arbitrary vision/tool models, rejects incompatible or remote backends', async (t) => {
  const { settings, routes } = await ollama(t, capable);
  assert.equal((await validateLocalModel(settings)).maxContext, 131072);
  const report = await localModels(settings);
  assert.equal(report.models[0].name, 'custom:vision');
  assert.ok(report.selected.capabilities.includes('vision'));
  assert.ok(
    routes.every((r) => ['/api/show', '/api/tags'].includes(r)),
    'metadata only, no inference',
  );
  for (const endpoint of [
    'https://example.com',
    'http://127.0.0.1@evil.example',
    'http://localhost/path',
    'http://localhost/?redirect=1',
  ])
    assert.equal(LocalSettings.safeParse({ ...settings, endpoint }).success, false);
  assert.equal(LocalSettings.safeParse({ ...settings, contextTokens: 4096 }).success, false);
  await assert.rejects(validateLocalModel({ ...settings, model: 'qwen-cloud' }), /cloud/);
  await assert.rejects(validateLocalModel({ ...settings, contextTokens: 262144 }), /limit/);
});
for (const [info, pattern] of [
  [{ ...capable, capabilities: ['tools'] }, /vision/],
  [{ ...capable, capabilities: ['vision'] }, /tools/],
  [{ ...capable, remote_host: 'https://ollama.com' }, /Cloud/],
  [{ ...capable, parameters: 'num_ctx 4096\ntemperature 0.5' }, /4096/],
])
  test('local capability validation fails closed ' + JSON.stringify(info), async (t) => {
    const { settings } = await ollama(t, info);
    await assert.rejects(validateLocalModel(settings), pattern);
  });
test('hardware suggestions reserve context headroom and do not assume unknown GPU memory', () => {
  assert.equal(
    suggestModels({ ramGiB: 60, vramGiB: 16, unifiedMemory: false })[0].model,
    'qwen3.5:9b',
  );
  assert.equal(
    suggestModels({ ramGiB: 64, vramGiB: 48, unifiedMemory: false })[0].model,
    'qwen3.5:27b',
  );
  assert.equal(suggestModels({ ramGiB: 60, unifiedMemory: false })[0].model, 'qwen3.5:4b');
  assert.deepEqual(suggestModels({ ramGiB: 4, unifiedMemory: false }), []);
});
test('local settings are validated across IPC, including arbitrary model names', async () => {
  const settings = {
    endpoint: 'http://127.0.0.1:11434',
    model: 'my-model:vision',
    contextTokens: 65536,
  };
  let seen;
  await dispatchWorker(
    {
      connect: async (...args) => {
        seen = args;
      },
    },
    'connect',
    [null, false, 'ollama', settings],
  );
  assert.deepEqual(seen, [undefined, false, 'ollama', settings]);
  await assert.rejects(
    dispatchDesktop({ configureLocal: async () => {} }, 'configureLocal', [
      { ...settings, endpoint: 'http://remote.example' },
    ]),
  );
});
test('local memory requires resume, retrieval, exact read and a durable note after effects; retries stay idempotent', async (t) => {
  const { store, service, backend } = await fixture(t);
  await record(service, 'The ferryman promised a blue boat.');
  const guard = new LocalMemoryGuard(store);
  const submit = async (id) =>
    store.transact(
      {
        operationId: `submit-${id}`,
        expectedRevision: (await store.read()).state.revision,
        actor: 'test',
        reason: 'Test',
      },
      { id },
      () => ({
        changes: [],
        records: [],
        table: { type: 'submit', id, text: 'Recall the promise' },
      }),
    );
  await submit('first');
  const call = async (name, input) => {
    await guard.before(name, input);
    const out = await service.execute(name, input);
    guard.after(name, input, out);
    return out;
  };
  const publication = {
    operationId: 'publish-first',
    expectedRevision: 2,
    reason: 'test',
    requestId: 'first',
    text: 'A blue boat awaits.',
  };
  await assert.rejects(call('publish_table_message', publication), /resume_campaign/);
  const resume = await call('resume_campaign', { audience: 'dm' });
  // Unavailable search may use durable references; no need to stop play or invent memory.
  backend.fail = true;
  await call('search_campaign_history', { audience: 'dm', query: 'boat', limit: 3 });
  await assert.rejects(call('publish_table_message', publication), /read_campaign_record/);
  await call('read_campaign_record', {
    audience: 'dm',
    reference: resume.recentRecords[0].reference,
  });
  await assert.rejects(call('publish_table_message', publication), /record_scene/);
  await record(service, 'They recall the blue boat.');
  await apply(service, [{ type: 'put_entity', entity: hero }]);
  await assert.rejects(call('publish_table_message', publication), /after state changes/);
  await record(service, 'The party recalled the boat and checked their sheet.');
  publication.expectedRevision = (await store.read()).state.revision;
  await call('publish_table_message', publication);
  await call('publish_table_message', publication);
  assert.equal((await store.read()).state.table[0].messages.length, 1);
  // New server can honor the same saved publication retry without forcing fresh writes.
  const restarted = new LocalMemoryGuard(store);
  await restarted.before('publish_table_message', publication);
  await store.transact(
    {
      operationId: 'finish',
      expectedRevision: (await store.read()).state.revision,
      actor: 'test',
      reason: 'Test',
    },
    {},
    () => ({
      changes: [],
      records: [],
      table: { type: 'finish', requestId: 'first', status: 'completed' },
    }),
  );
  await submit('second');
  await assert.rejects(
    guard.before('publish_table_message', { operationId: 'publish-second' }),
    /resume_campaign/,
  );
});

test('local context validation rejects silent runner truncation', async (t) => {
  const { verifyLocalContext } = await import('../dist/desktop/local.js');
  let context = 4096;
  const server = createServer((req, res) =>
    res.end(JSON.stringify({ models: [{ name: 'custom:vision', context_length: context }] })),
  );
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => new Promise((r) => server.close(r)));
  const settings = {
    endpoint: `http://127.0.0.1:${server.address().port}`,
    model: 'custom:vision',
    contextTokens: 32768,
  };
  await assert.rejects(verifyLocalContext(settings), /silently smaller/);
  context = 65536;
  await verifyLocalContext(settings);
});

test('local model/context switches cannot resume a different model session or alter plugin settings', async (t) => {
  const { DesktopHost } = await import('../dist/desktop/host.js');
  const { readFile, writeFile, mkdir } = await import('node:fs/promises');
  const { join, resolve } = await import('node:path');
  const { store } = await fixture(t);
  const server = createServer((req, res) =>
    res.end(
      JSON.stringify(
        req.url === '/api/ps'
          ? {
              models: ['custom:one', 'custom:two'].map((name) => ({ name, context_length: 65536 })),
            }
          : capable,
      ),
    ),
  );
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => new Promise((r) => server.close(r)));
  const settings = {
    endpoint: `http://127.0.0.1:${server.address().port}`,
    model: 'custom:one',
    contextTokens: 32768,
  };
  const seen = [];
  const host = new DesktopHost({
    source: resolve('.'),
    probe: async () => ({ path: process.execPath, version: 'test' }),
    driver: (options) => {
      seen.push(options);
      return {
        run: async () => {
          await options.onConversation(options.conversationId ?? `thread-${seen.length}`);
          return { tools: [], campaignIds: ['test'] };
        },
        close: async () => {},
      };
    },
  });
  t.after(() => host.close());
  await mkdir(join(store.root, '.codex'), { recursive: true });
  await writeFile(join(store.root, '.codex/config.toml'), '# campaign plugin\n');
  await host.open(store.root);
  await host.connect(undefined, false, 'ollama', settings);
  await host.connect(undefined, false, 'ollama', settings);
  await host.connect(undefined, false, 'ollama', { ...settings, model: 'custom:two' });
  await host.connect(undefined, false, 'ollama', {
    ...settings,
    model: 'custom:two',
    contextTokens: 65536,
  });
  assert.deepEqual(
    seen.map((s) => s.conversationId),
    [undefined, 'thread-1', undefined, undefined],
  );
  assert.ok(seen.every((s) => s.env.CODEX_HOME.endsWith('ollama-workspace/codex-home')));
  const catalog = JSON.parse(await readFile(seen.at(-1).modelCatalog, 'utf8'));
  assert.deepEqual(catalog.models[0].input_modalities, ['text', 'image']);
  assert.equal(catalog.models[0].slug, 'custom:two');
  await assert.rejects(host.submit({ id: 'too-large', text: 'x'.repeat(20000) }), /too large/);
  assert.equal((await store.events()).length, 0);
  assert.equal(
    await readFile(join(store.root, '.codex/config.toml'), 'utf8'),
    '# campaign plugin\n',
  );
  assert.equal((await store.events()).length, 0);
});

test('local model catalog enables actual image input without assuming reasoning support', () => {
  const settings = {
    model: 'any-custom:vision',
    endpoint: 'http://127.0.0.1:11434',
    contextTokens: 65536,
  };
  const model = localModelCatalog(settings, ['vision', 'tools']).models[0];
  assert.equal(model.slug, settings.model);
  assert.deepEqual(model.input_modalities, ['text', 'image']);
  assert.equal(model.default_reasoning_level, 'none');
  assert.deepEqual(model.supported_reasoning_levels, []);
  assert.equal(model.context_window, 65536);
  assert.equal(
    localModelCatalog(settings, ['vision', 'tools', 'thinking']).models[0].default_reasoning_level,
    'low',
  );
});

test('local MCP image compatibility preserves PNG and JSON while default plugin output stays structured', async () => {
  const { createMcpServer } = await import('../dist/server.js');
  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
  const { InMemoryTransport } = await import('@modelcontextprotocol/sdk/inMemory.js');
  for (const imageContentOnly of [false, true]) {
    const server = createMcpServer(
      {
        execute: async () => ({
          revision: 3,
          mapId: 'map',
          image: { data: 'aGVsbG8=', mimeType: 'image/png' },
        }),
      },
      { imageContentOnly },
    );
    const client = new Client({ name: 'test', version: '1' });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await server.connect(a);
    await client.connect(b);
    try {
      const result = await client.callTool({
        name: 'render_location_map',
        arguments: { mapId: 'map', audience: 'party' },
      });
      assert.equal(result.content[1].type, 'image');
      assert.equal(JSON.parse(result.content[0].text).revision, 3);
      if (imageContentOnly) assert.equal(result.structuredContent, undefined);
      else assert.equal(result.structuredContent.revision, 3);
    } finally {
      await client.close();
      await server.close();
    }
  }
});
