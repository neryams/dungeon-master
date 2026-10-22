import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, readFile, mkdir, symlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { CodexSession } from '../dist/desktop/codex.js';
import { DesktopHost } from '../dist/desktop/host.js';
import { prepareWorkspace } from '../dist/desktop/antigravity.js';
import { fixture } from './helpers.mjs';

async function driverFixture(t, extras = {}) {
  const { parent } = await fixture(t);
  const path = join(parent, 'app-server.mjs');
  await writeFile(
    path,
    `
import { createInterface } from 'node:readline';
import { appendFileSync } from 'node:fs';
const send = m => process.stdout.write(JSON.stringify(m)+'\\n');
let turn = 0;
createInterface({input:process.stdin}).on('line', line => {
 const m=JSON.parse(line);
 appendFileSync(${JSON.stringify(join(parent, 'requests.jsonl'))}, line+'\\n');
 if(m.method===process.env.DM_FIXTURE_RPC_FAIL) return send({id:m.id,error:{code:-1,message:'PRIVATE_SECRET'}});
 if(m.method==='turn/steer') return send(process.env.DM_FIXTURE_STEER_FAIL==='true'?{id:m.id,error:{code:-1}}:{id:m.id,result:{turnId:m.params.expectedTurnId}});
 if(m.method==='initialize') send({id:m.id,result:{}});
 if(m.method==='account/read') send({id:m.id,result:{account:process.env.DM_FIXTURE_AUTH==='none'?null:{type:process.env.DM_FIXTURE_AUTH??'chatgpt'}}});
 if(m.method==='config/read') send({id:m.id,result:{config:{mcp_servers:{unrelated:{command:'ignored',tool_timeout_sec:null}},plugins:{'old@market':{enabled:true}}}}});
 if(m.method==='thread/start'||m.method==='thread/resume') send({id:m.id,result:{thread:{id:'thread-1'}}});
 if(m.method==='thread/compact/start') {
   const id='compact-'+(++turn);
   send({id:m.id,result:{}});
   send({method:'turn/started',params:{threadId:'thread-1',turn:{id}}});
   send({method:'item/started',params:{threadId:'thread-1',turnId:id,item:{type:'contextCompaction',id:'compaction'}}});
   setTimeout(()=>{
     if(process.env.DM_FIXTURE_COMPACT_FAIL!=='true') send({method:'item/completed',params:{threadId:'thread-1',turnId:id,item:{type:'contextCompaction',id:'compaction'}}});
     send({method:'turn/completed',params:{threadId:'thread-1',turn:{id,status:'completed'}}});
   },25);
   return;
 }
 if(m.method!=='turn/start') return;
 const text=m.params.input[0].text, id='turn-'+(++turn);
 send({method:'turn/started',params:{threadId:'thread-1',turn:{id}}});
 send({id:m.id,result:{turn:{id}}});
 if(text==='hang') return;
 if(text.startsWith('autocompact')) send({method:'item/completed',params:{threadId:'thread-1',turnId:id,item:{type:'contextCompaction'}}});
 if(text==='exit') return process.exit(1);
 if(text==='bad') return process.stdout.write('not json\\n');
 if(text==='approval') return send({id:999,method:'item/commandExecution/requestApproval',params:{threadId:'thread-1',turnId:id}});
 const output={campaign:{schemaVersion:1,id:'test'},revision:0,journal:{}};
 const item={type:'mcpToolCall',server:'campaign',tool:'campaign_status',status:'completed',result:{content:[{type:'text',text:JSON.stringify(output)}]}};
 if(text==='tool-errors'||text==='recover-errors') {
   for(let i=0;i<9;i++) send({method:'item/completed',params:{threadId:'thread-1',turnId:id,item:text==='recover-errors'&&i===5?item:{...item,status:i%2?'failed':'completed',result:{isError:true},error:i%2?{message:'PRIVATE_SECRET'}:null}}});
 }
 // Other threads/turns/servers and raw prose cannot establish readiness.
 send({method:'item/completed',params:{threadId:'unrelated',turnId:id,item}});
 send({method:'item/completed',params:{threadId:'thread-1',turnId:'stale-turn',item}});
 send({method:'item/completed',params:{threadId:'thread-1',turnId:id,item:{...item,server:'unrelated'}}});
 send({method:'item/completed',params:{threadId:'thread-1',turnId:id,item:{type:'agentMessage',text:'PRIVATE_SECRET '+JSON.stringify(output)}}});
 if(text==='image') {
   send({method:'item/completed',params:{threadId:'other',turnId:id,item:{type:'imageGeneration',status:'completed',savedPath:'/unrelated.png'}}});
   send({method:'item/completed',params:{threadId:'thread-1',turnId:id,item:{type:'imageGeneration',status:'completed',savedPath:'/generated.png'}}});
 }
 if(text!=='fake') send({method:'item/completed',params:{threadId:'thread-1',turnId:id,item}});
 const done=JSON.stringify({method:'turn/completed',params:{threadId:'thread-1',turn:{id,status:text==='fail'?'failed':'completed',error:{message:'PRIVATE_SECRET'}}}})+'\\n';
 if(text.startsWith('autocompact')) setTimeout(()=>process.stdout.write(done),25);
 else {process.stdout.write(done.slice(0,17));setTimeout(()=>process.stdout.write(done.slice(17)),5);}
});
`,
  );
  const progress = [];
  const driver = new CodexSession({
    executable: process.execPath,
    prefixArgs: [path],
    cwd: parent,
    serverName: 'campaign',
    server: { command: 'node', args: ['server.js'], env: {} },
    progress: (text) => progress.push(text),
    timeoutMs: 2000,
    ...extras,
  });
  t.after(() => driver.close());
  return { driver, parent, progress };
}

test('Codex protocol authenticates, scopes configuration, correlates events and never exposes raw output', async (t) => {
  const { driver, parent, progress } = await driverFixture(t);
  const result = await driver.run('hello');
  assert.deepEqual(result, {
    conversationId: 'thread-1',
    tools: ['campaign_status'],
    campaignIds: ['test'],
  });
  assert.deepEqual((await driver.run('fake')).campaignIds, []);
  assert.doesNotMatch(JSON.stringify([result, progress]), /PRIVATE_SECRET/);
  const requests = (await readFile(join(parent, 'requests.jsonl'), 'utf8'))
    .trim()
    .split('\n')
    .map(JSON.parse);
  assert.deepEqual(
    requests.slice(0, 5).map((r) => r.method),
    ['initialize', 'initialized', 'account/read', 'config/read', 'thread/start'],
  );
  const config = requests.find((r) => r.method === 'thread/start').params;
  assert.equal(config.sandbox, 'read-only');
  assert.equal(config.config.mcp_servers.unrelated.enabled, false);
  assert.equal(config.config.mcp_servers.campaign.required, true);
  assert.equal(config.config.plugins['old@market'].enabled, false);
  assert.equal(config.config['features.shell_tool'], false);
  const pending = driver.run('hang');
  const rejected = assert.rejects(pending, /stopped/);
  await assert.rejects(driver.run('duplicate'), /already resolving/);
  await driver.close();
  await rejected;
  await assert.rejects(driver.run('retry'), /stopped/);
});

for (const [prompt, pattern] of [
  ['fail', /did not complete/],
  ['bad', /invalid protocol/],
  ['exit', /disconnected/],
  ['approval', /unsupported interactive/],
  ['hang', /timed out/],
]) {
  test(`Codex fails closed on ${prompt} without retrying`, async (t) => {
    const { driver } = await driverFixture(t, { timeoutMs: 250 });
    await assert.rejects(driver.run(prompt), pattern);
    await assert.rejects(driver.run('retry'), /stopped/);
  });
}

test('Codex resumes its thread and does not silently replace missing context', async (t) => {
  const { driver, parent } = await driverFixture(t, { conversationId: 'thread-1' });
  await driver.run('hello');
  const requests = (await readFile(join(parent, 'requests.jsonl'), 'utf8'))
    .trim()
    .split('\n')
    .map(JSON.parse);
  assert.equal(requests.find((r) => r.method === 'thread/resume').params.threadId, 'thread-1');
  assert.ok(!requests.some((r) => r.method === 'thread/start'));
});

test('provider switching keeps separate context, resets durably, and preserves plugin configuration', async (t) => {
  const { store, parent } = await fixture(t);
  await mkdir(join(store.root, '.codex'), { recursive: true });
  const plugin = join(store.root, '.codex/config.toml');
  await writeFile(plugin, '# existing plugin configuration\n');
  const seen = [];
  const host = new DesktopHost({
    source: resolve('.'),
    permissionPath: join(parent, 'agy.json'),
    probe: async () => ({ path: process.execPath, version: 'test' }),
    driver: (options) => {
      seen.push(options.conversationId);
      return {
        run: async () => {
          await options.onConversation(options.conversationId ?? `session-${seen.length}`);
          return { tools: [], campaignIds: ['test'] };
        },
        close: async () => {},
      };
    },
  });
  t.after(() => host.close());
  await host.open(store.root);
  await host.connect();
  const agySettings = await readFile(join(parent, 'agy.json'), 'utf8');
  await host.connect(undefined, false, 'codex');
  await host.connect();
  await host.connect(undefined, false, 'codex');
  await host.connect(undefined, true, 'codex');
  assert.deepEqual(seen, [undefined, undefined, 'session-1', 'session-2', undefined]);
  assert.equal(await readFile(plugin, 'utf8'), '# existing plugin configuration\n');
  assert.equal(await readFile(join(parent, 'agy.json'), 'utf8'), agySettings);
  assert.equal(
    JSON.parse(await readFile(join(store.root, '.dm/hotseat/session.json'), 'utf8')).conversationId,
    'session-1',
  );
  assert.equal(
    JSON.parse(await readFile(join(store.root, '.dm/hotseat/codex-session.json'), 'utf8'))
      .conversationId,
    'session-5',
  );
  assert.equal((await store.events()).length, 0);
  const workspace = await prepareWorkspace(store, resolve('.'), {}, 'owner', 'codex');
  assert.equal(workspace.server.env.DM_DESKTOP_PROVIDER, 'codex');
  assert.ok(workspace.dir.endsWith('codex-workspace'));
});

test('Codex artwork import accepts only observed raster paths for the current owner', async (t) => {
  const { store, parent } = await fixture(t);
  const { importGeneratedArt } = await import('../dist/desktop/art.js');
  const sharp = (await import('sharp')).default;
  const image = join(parent, 'generated.png');
  await sharp({ create: { width: 32, height: 32, channels: 3, background: '#735' } })
    .png()
    .toFile(image);
  await mkdir(join(store.root, '.dm/hotseat'), { recursive: true });
  const manifest = join(store.root, '.dm/hotseat/codex-artifacts.json');
  const save = (paths) => writeFile(manifest, JSON.stringify({ ownerToken: 'owner', paths }));
  await save([image]);
  const art = await importGeneratedArt(store, image, undefined, { ownerToken: 'owner' });
  assert.deepEqual(await readFile(join(store.root, art.path)), await readFile(image));
  assert.deepEqual(await importGeneratedArt(store, image, undefined, { ownerToken: 'owner' }), art);
  await assert.rejects(
    importGeneratedArt(store, image, undefined, { ownerToken: 'old-owner' }),
    /connected Codex/,
  );
  await assert.rejects(
    importGeneratedArt(store, join(parent, 'unobserved.png'), undefined, { ownerToken: 'owner' }),
    /connected Codex/,
  );
  const link = join(parent, 'symlink.png');
  await symlink(image, link);
  await save([link]);
  await assert.rejects(
    importGeneratedArt(store, link, undefined, { ownerToken: 'owner' }),
    /Symlinks/,
  );
  const bad = join(parent, 'bad.png');
  await writeFile(bad, 'not an image');
  await save([bad]);
  await assert.rejects(importGeneratedArt(store, bad, undefined, { ownerToken: 'owner' }));
  assert.equal(
    (await store.events()).length,
    0,
    'File import never registers or mutates game state',
  );
});

for (const auth of ['none', 'apiKey']) {
  test(`Codex requires managed ChatGPT auth (${auth}) without starting a thread`, async (t) => {
    const { driver, parent } = await driverFixture(t, {
      env: { ...process.env, DM_FIXTURE_AUTH: auth },
    });
    await assert.rejects(driver.run('hello'), /codex login/);
    assert.doesNotMatch(await readFile(join(parent, 'requests.jsonl'), 'utf8'), /thread\/start/);
  });
}
test('Codex resume RPC failure never starts a replacement thread', async (t) => {
  const { driver, parent } = await driverFixture(t, {
    conversationId: 'missing',
    env: { ...process.env, DM_FIXTURE_RPC_FAIL: 'thread/resume' },
  });
  await assert.rejects(driver.run('hello'), /Reset DM context/);
  assert.doesNotMatch(await readFile(join(parent, 'requests.jsonl'), 'utf8'), /thread\/start/);
});
test('Codex records only its generated paths and awaits artifact bookkeeping', async (t) => {
  const paths = [];
  const { driver } = await driverFixture(t, {
    onImage: async (path) => {
      await new Promise((r) => setTimeout(r, 25));
      paths.push(path);
    },
  });
  await driver.run('image');
  assert.deepEqual(paths, ['/generated.png']);
});
test('Codex artifact bookkeeping failure prevents a successful completion', async (t) => {
  const { driver } = await driverFixture(t, {
    onImage: async () => {
      throw Error('disk failed');
    },
  });
  await assert.rejects(driver.run('image'), /record generated artwork/);
});

test('local Codex mode scopes its backend, skips ChatGPT auth and configures automatic compaction', async (t) => {
  const { driver, parent } = await driverFixture(t, {
    local: { endpoint: 'http://127.0.0.1:11435', model: 'custom-vision:9b', contextTokens: 32768 },
    env: { ...process.env, DM_FIXTURE_AUTH: 'none' },
    onImage: () => {
      throw Error('Local mode must not import cloud artwork');
    },
  });
  await driver.run('image');
  const requests = (await readFile(join(parent, 'requests.jsonl'), 'utf8'))
    .trim()
    .split('\n')
    .map(JSON.parse);
  assert.ok(!requests.some((r) => r.method === 'account/read'));
  const params = requests.find((r) => r.method === 'thread/start').params;
  assert.equal(params.model, 'custom-vision:9b');
  assert.equal(params.modelProvider, 'dm_ollama');
  assert.equal(params.config.model_providers.dm_ollama.requires_openai_auth, false);
  assert.equal(params.config.model_providers.dm_ollama.base_url, 'http://127.0.0.1:11435/v1');
  assert.equal(params.config.model_context_window, 32768);
  assert.equal(params.config.model_auto_compact_token_limit, Math.floor(32768 * 0.7));
  assert.match(params.config.compact_prompt, /operation IDs/);
  assert.match(params.developerInstructions, /search_campaign_history/);
  assert.equal(params.config['features.image_generation'], false);
  assert.equal(params.config['memories.generate_memories'], false);
  assert.equal(params.config['memories.use_memories'], false);
});

test('native compaction waits for its matching completed item and turn', async (t) => {
  const { driver, progress } = await driverFixture(t);
  await assert.rejects(driver.compact(), /Connect/);
  await driver.run('hello');
  const compact = driver.compact();
  await assert.rejects(driver.run('overlap'), /already resolving/);
  await compact;
  assert.ok(progress.some((p) => p.startsWith('Compacting')));
  assert.equal((await driver.run('hello')).campaignIds[0], 'test');
});
test('native compaction acknowledgment alone cannot establish completion', async (t) => {
  const { driver } = await driverFixture(t, {
    env: { ...process.env, DM_FIXTURE_COMPACT_FAIL: 'true' },
  });
  await driver.run('hello');
  await assert.rejects(driver.compact(), /compaction did not complete/);
  await assert.rejects(driver.run('retry'), /stopped/);
});

test('local mid-turn compaction restores only the active request with turn/steer', async (t) => {
  const { driver, parent } = await driverFixture(t, {
    local: { endpoint: 'http://127.0.0.1:11435', model: 'qwen3.5:9b', contextTokens: 32768 },
  });
  await driver.run('autocompact requestId current-request; saved operationId damage-once');
  const requests = (await readFile(join(parent, 'requests.jsonl'), 'utf8'))
    .trim()
    .split('\n')
    .map(JSON.parse);
  const steer = requests.find((r) => r.method === 'turn/steer');
  assert.equal(steer.params.expectedTurnId, 'turn-1');
  assert.match(steer.params.input[0].text, /current-request/);
  assert.match(steer.params.input[0].text, /Do not repeat saved damage/);
  assert.equal(requests.filter((r) => r.method === 'turn/start').length, 1);
});
test('failed compaction continuation fails closed without replay', async (t) => {
  const { driver } = await driverFixture(t, {
    local: { endpoint: 'http://127.0.0.1:11435', model: 'qwen3.5:9b', contextTokens: 32768 },
    env: { ...process.env, DM_FIXTURE_STEER_FAIL: 'true' },
  });
  await assert.rejects(driver.run('autocompact'), /restore the active request/);
  await assert.rejects(driver.run('retry'), /stopped/);
});

test('compaction handoff excludes the long skill/history preamble', async (t) => {
  const { driver, parent } = await driverFixture(t, {
    local: { endpoint: 'http://127.0.0.1:11435', model: 'qwen3.5:9b', contextTokens: 32768 },
  });
  await driver.run(
    'autocompact ' +
      'OLD_PREAMBLE '.repeat(1500) +
      '\n\nCurrent player submission: ' +
      JSON.stringify({ requestId: 'current-only', text: 'Continue from saved outcomes.' }),
  );
  const requests = (await readFile(join(parent, 'requests.jsonl'), 'utf8'))
    .trim()
    .split('\n')
    .map(JSON.parse);
  const text = requests.find((r) => r.method === 'turn/steer').params.input[0].text;
  assert.match(text, /current-only/);
  assert.doesNotMatch(text, /OLD_PREAMBLE/);
  assert.ok(text.length < 1000);
});

test('local tool failure loops stop without replay, while successful recovery resets the budget', async (t) => {
  const local = {
    endpoint: 'http://127.0.0.1:11434',
    model: 'custom-vision',
    contextTokens: 65536,
  };
  const { driver, parent } = await driverFixture(t, { local });
  await driver.run('recover-errors');
  await assert.rejects(driver.run('tool-errors'), /eight consecutive campaign tool calls/);
  await assert.rejects(driver.run('retry'), /stopped/);
  const requests = (await readFile(join(parent, 'requests.jsonl'), 'utf8'))
    .trim()
    .split('\n')
    .map(JSON.parse);
  assert.equal(requests.filter((r) => r.method === 'turn/start').length, 2);
  const hosted = await driverFixture(t);
  assert.deepEqual((await hosted.driver.run('tool-errors')).campaignIds, ['test']);
});
