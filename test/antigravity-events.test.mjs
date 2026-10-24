import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AntigravitySession } from '../dist/desktop/antigravity.js';

test('Antigravity tool_info events correlate repeated and parallel steps without exposing payloads', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'dm-agy-events-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const cli = join(root, 'fake-agy.mjs');
  await writeFile(
    cli,
    `import readline from 'node:readline';
const line = event => process.stdout.write(JSON.stringify(event) + '\\n');
readline.createInterface({ input: process.stdin }).on('line', () => {
 line({event:'step_update',step_update:{step_type:'agent_response',text_delta:'PRIVATE_NARRATION'}});
 const started = (step_index, name) => ({event:'step_update',step_update:{step_type:'tool',step_index,state:'ACTIVE',tool_name:name,tool_info:{name,parameters:{secret:'PRIVATE_ARGUMENT',...(name==='invoke_subagent'?{Model:'flash'}:{})}}}});
 line(started(1,'invoke_subagent'));
 line(started(1,'invoke_subagent'));
 line(started(2,'approve_action_effects'));
 const ended = (step_index,name,output,duration_seconds) => ({event:'step_update',step_update:{step_type:'tool',step_index,state:'DONE',duration_seconds,tool_name:name,tool_info:{name,parameters:{secret:'PRIVATE_ARGUMENT',...(name==='invoke_subagent'?{Model:'flash'}:{})},output}}});
 const failedReadiness = {event:'step_update',step_update:{step_type:'tool',step_index:3,state:'DONE',tool_name:'call_mcp_tool',tool_info:{name:'call_mcp_tool',output:JSON.stringify({campaign:{schemaVersion:1,id:'campaign-1'},revision:1,journal:{}}),error:'PRIVATE_ERROR'}}};
 const failed = {event:'step_update',step_update:{step_type:'tool',step_index:4,state:'FAILED',tool_name:'send_message',tool_info:{name:'send_message',error:'PRIVATE_ERROR'}}};
 const unapprovedModel = {event:'step_update',step_update:{step_type:'tool',step_index:5,state:'FAILED',tool_name:'invoke_subagent',tool_info:{name:'invoke_subagent',parameters:{Model:'PRIVATE_MODEL'},error:'PRIVATE_ERROR'}}};
 line(ended(2,'approve_action_effects','PRIVATE_RESULT',0.027));
 line(ended(1,'invoke_subagent','PRIVATE_RESULT',0.032));
 line(ended(1,'invoke_subagent','PRIVATE_RESULT',0.032));
 line(failedReadiness);
 line(failed);
 line(unapprovedModel);
 line({event:'result',result:{status:'SUCCESS',response:'PRIVATE_NARRATION'}});
});`,
  );
  const timings = [];
  const progress = [];
  const session = new AntigravitySession({
    executable: process.execPath,
    prefixArgs: [cli],
    cwd: root,
    model: 'selected-model',
    timeoutMs: 2000,
    onTiming: (event) => timings.push(event),
    progress: (text) => progress.push(text),
  });
  t.after(() => session.close());
  const result = await session.run('synthetic protocol exercise', 'request-1');

  const starts = timings.filter((event) => event.kind === 'provider-tool-start');
  const ends = timings.filter((event) => event.kind === 'provider-tool-end');
  assert.deepEqual(
    starts.map((event) => event.callId),
    ['step-1', 'step-2'],
  );
  assert.deepEqual(
    ends.map(({ callId, status, elapsedMs }) => ({ callId, status, elapsedMs })),
    [
      { callId: 'step-2', status: 'ok', elapsedMs: 27 },
      { callId: 'step-1', status: 'ok', elapsedMs: 32 },
      { callId: 'step-3', status: 'error', elapsedMs: undefined },
      { callId: 'step-4', status: 'error', elapsedMs: undefined },
      { callId: 'step-5', status: 'error', elapsedMs: undefined },
    ],
  );
  assert(timings.every((event) => event.requestId === 'request-1'));
  assert(timings.every((event) => event.model === 'selected-model'));
  assert.equal(ends.find((event) => event.callId === 'step-1')?.childModel, 'flash');
  assert.equal(ends.find((event) => event.callId === 'step-5')?.childModel, undefined);
  assert.deepEqual(result.tools.sort(), ['approve_action_effects', 'invoke_subagent']);
  assert.deepEqual(result.campaignIds, []);
  assert(progress.includes('Checking the rules…'));
  assert(progress.every((entry) => !/PRIVATE_|invoke_subagent|approve_action_effects/.test(entry)));
  assert.doesNotMatch(JSON.stringify([result, timings, progress]), /PRIVATE_/);
});
