import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { providerModels } from '../dist/desktop/models.js';
import { fixture } from './helpers.mjs';

test('Antigravity model discovery parses TSV, ignores stderr, filters unsafe IDs and deduplicates', async (t) => {
  const { parent } = await fixture(t);
  const cli = join(parent, 'agy.mjs');
  await writeFile(
    cli,
    `
import { writeFileSync } from 'node:fs';
writeFileSync(${JSON.stringify(join(parent, 'agy-args.json'))}, JSON.stringify(process.argv.slice(2)));
process.stderr.write('Fetching available models...\\n');
process.stdout.write('gemini-4-argon-medium\\tGemini 4 Argon (Medium)\\nunsafe id\\tBad\\ngemini-4-argon-medium\\tGemini 4 Argon (Medium)\\nclaude-sonnet-5-5-high\\tClaude Sonnet 5.5 (High)\\n');
`,
  );
  const result = await providerModels(process.execPath, 'antigravity', {
    prefixArgs: [cli],
    cwd: parent,
  });
  assert.deepEqual(result, {
    models: [
      { id: 'gemini-4-argon-medium', name: 'Gemini 4 Argon (Medium)' },
      { id: 'claude-sonnet-5-5-high', name: 'Claude Sonnet 5.5 (High)' },
    ],
  });
  assert.deepEqual(JSON.parse(await readFile(join(parent, 'agy-args.json'), 'utf8')), ['models']);
});

test('Antigravity rejects empty and malformed catalogs', async (t) => {
  const { parent } = await fixture(t);
  for (const [name, output, expected] of [
    ['empty', '', /no available models/],
    ['malformed', 'gemini\tName\textra\n', /malformed model catalog/],
  ]) {
    const cli = join(parent, `${name}.mjs`);
    await writeFile(cli, `process.stdout.write(${JSON.stringify(output)});`);
    await assert.rejects(
      providerModels(process.execPath, 'antigravity', { prefixArgs: [cli], cwd: parent }),
      expected,
    );
  }
});

test('Codex model discovery paginates through bounded read-only app-server RPC', async (t) => {
  const { parent } = await fixture(t);
  const server = join(parent, 'app-server.mjs');
  await writeFile(
    server,
    `
import { createInterface } from 'node:readline';
import { appendFileSync } from 'node:fs';
const send = message => process.stdout.write(JSON.stringify(message)+'\\n');
createInterface({ input: process.stdin }).on('line', line => {
 const request = JSON.parse(line);
 appendFileSync(${JSON.stringify(join(parent, 'requests.jsonl'))}, line+'\\n');
 if(request.method === 'initialize') send({id:request.id,result:{}});
 if(request.method === 'model/list' && !request.params.cursor) send({id:request.id,result:{data:[
   {model:'gpt-6',displayName:'GPT-6',description:'Default model',isDefault:true,hidden:false},
   {model:'hidden-model',displayName:'Hidden',hidden:true}
 ],nextCursor:'page-2'}});
 if(request.method === 'model/list' && request.params.cursor === 'page-2') send({id:request.id,result:{data:[
   {model:'gpt-6',displayName:'GPT-6'},
   {model:'gpt-6-mini',displayName:'GPT-6 Mini',description:'Fast model',isDefault:false,hidden:false}
 ],nextCursor:null}});
});
`,
  );
  const result = await providerModels(process.execPath, 'codex', {
    prefixArgs: [server],
    cwd: parent,
    timeoutMs: 1000,
  });
  assert.deepEqual(result, {
    models: [
      { id: 'gpt-6', name: 'GPT-6', description: 'Default model', isDefault: true },
      { id: 'gpt-6-mini', name: 'GPT-6 Mini', description: 'Fast model' },
    ],
    defaultModel: 'gpt-6',
  });
  const requests = (await readFile(join(parent, 'requests.jsonl'), 'utf8'))
    .trim()
    .split('\n')
    .map(JSON.parse);
  assert.deepEqual(
    requests.map((request) => request.method),
    ['initialize', 'initialized', 'model/list', 'model/list'],
  );
  assert.deepEqual(
    requests.filter((request) => request.method === 'model/list').map((request) => request.params),
    [
      { limit: 100, includeHidden: false },
      { limit: 100, includeHidden: false, cursor: 'page-2' },
    ],
  );
  assert.ok(!requests.some((request) => /thread\/(start|resume)|turn\/start/.test(request.method)));
});

test('Codex model discovery rejects malformed pages and kills a timed out owned process', async (t) => {
  const { parent } = await fixture(t);
  const malformed = join(parent, 'malformed.mjs');
  await writeFile(
    malformed,
    `
import { createInterface } from 'node:readline';
const send = message => process.stdout.write(JSON.stringify(message)+'\\n');
createInterface({ input: process.stdin }).on('line', line => {
 const request=JSON.parse(line);
 if(request.method==='initialize') send({id:request.id,result:{}});
 if(request.method==='model/list') send({id:request.id,result:{data:[{model:'bad model',displayName:'Bad'}]}});
});
`,
  );
  await assert.rejects(
    providerModels(process.execPath, 'codex', {
      prefixArgs: [malformed],
      cwd: parent,
      timeoutMs: 1000,
    }),
    /no available models/,
  );

  const hanging = join(parent, 'hanging.mjs');
  await writeFile(
    hanging,
    `
import { createInterface } from 'node:readline';
import { writeFileSync } from 'node:fs';
process.on('SIGTERM', () => {});
writeFileSync(${JSON.stringify(join(parent, 'owned.pid'))}, String(process.pid));
createInterface({ input: process.stdin }).on('line', line => {
 const request=JSON.parse(line);
 if(request.method==='initialize') process.stdout.write(JSON.stringify({id:request.id,result:{}})+'\\n');
});
`,
  );
  await assert.rejects(
    providerModels(process.execPath, 'codex', {
      prefixArgs: [hanging],
      cwd: parent,
      timeoutMs: 100,
    }),
    /timed out/,
  );
  const pid = Number(await readFile(join(parent, 'owned.pid'), 'utf8'));
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });

  const agyHanging = join(parent, 'agy-hanging.mjs');
  await writeFile(
    agyHanging,
    `
import { writeFileSync } from 'node:fs';
process.on('SIGTERM', () => {});
writeFileSync(${JSON.stringify(join(parent, 'agy-owned.pid'))}, String(process.pid));
setInterval(() => {}, 1000);
`,
  );
  await assert.rejects(
    providerModels(process.execPath, 'antigravity', {
      prefixArgs: [agyHanging],
      cwd: parent,
      timeoutMs: 100,
    }),
    /Could not read available models/,
  );
  const agyPid = Number(await readFile(join(parent, 'agy-owned.pid'), 'utf8'));
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.throws(() => process.kill(agyPid, 0), { code: 'ESRCH' });
});

test('Codex model discovery rejects a repeated cursor instead of looping', async (t) => {
  const { parent } = await fixture(t);
  const server = join(parent, 'repeat-cursor.mjs');
  await writeFile(
    server,
    `
import { createInterface } from 'node:readline';
const send = message => process.stdout.write(JSON.stringify(message)+'\\n');
createInterface({ input: process.stdin }).on('line', line => {
 const request=JSON.parse(line);
 if(request.method==='initialize') send({id:request.id,result:{}});
 if(request.method==='model/list') send({id:request.id,result:{data:[{model:'gpt-6',displayName:'GPT-6'}],nextCursor:'same'}});
});
`,
  );
  await assert.rejects(
    providerModels(process.execPath, 'codex', {
      prefixArgs: [server],
      cwd: parent,
      timeoutMs: 1000,
    }),
    /repeated model catalog cursor/,
  );
});
