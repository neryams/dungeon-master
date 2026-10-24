import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  discoverAntigravityWorkflowModelOptions,
  selectRefereeModel,
} from '../dist/desktop/referee-model.js';

test('selects the documented routine referee tier only when advertised', () => {
  const selected = selectRefereeModel({
    provider: 'antigravity',
    supportedModelOptions: ['inherit', 'flash', 'flash_lite', 'pro'],
  });

  assert.equal(selected.model, 'flash');
  assert.equal(selected.explicit, true);
  assert.equal(selected.executionPath, 'workflow');
  assert.match(selected.instruction, /restrict tools and disable file writes where supported/);
  assert.match(
    selected.instruction,
    /agent\(type_name=<registered referee>, workspace="inherit", model="flash"\)/,
  );
  assert.match(selected.instruction, /Do not pass any model field to invoke_subagent/);
});

test('reads exact Antigravity child tiers from installed workflow guide metadata', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'dm-referee-model-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const guide = join(directory, 'SKILL.md');
  await writeFile(
    guide,
    '-   `model`: the agent\'s model tier: "inherit" (default, your model),\n    "flash_lite", "flash", or "pro". Use a lighter tier for simple work.\n-   `fn`: next argument\n',
  );

  const supportedModelOptions = await discoverAntigravityWorkflowModelOptions(guide);
  const selected = selectRefereeModel({
    provider: 'antigravity',
    supportedModelOptions,
  });

  assert.deepEqual(supportedModelOptions, ['flash', 'flash_lite', 'pro']);
  assert.equal(selected.model, 'flash');
  assert.equal(selected.executionPath, 'workflow');
  assert.match(selected.instruction, /model="flash"/);
  assert.match(selected.instruction, /Do not pass any model field to invoke_subagent/);
});

test('unknown or missing native guide metadata yields no Antigravity override', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'dm-referee-model-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const guide = join(directory, 'SKILL.md');
  await writeFile(guide, 'A changelog mentions flash and pro model names.\n');

  const supportedModelOptions = await discoverAntigravityWorkflowModelOptions(guide);
  const selected = selectRefereeModel({ provider: 'antigravity', supportedModelOptions });

  assert.deepEqual(supportedModelOptions, []);
  assert.equal(selected.model, 'inherit');
  assert.equal(selected.executionPath, 'inherit');
  assert.match(selected.instruction, /do not pass a model field/);
  assert.match(selected.instruction, /accept the inherited model/);
});

test('does not treat concrete agy catalogue model IDs as child tier overrides', () => {
  const selected = selectRefereeModel({
    provider: 'antigravity',
    supportedModelOptions: ['gemini-3.8-flash-low', 'claude-sonnet-5-5-low'],
  });

  assert.equal(selected.model, 'inherit');
  assert.equal(selected.explicit, false);
  assert.equal(selected.executionPath, 'inherit');
  assert.match(selected.instruction, /Do not infer child tiers from agy models catalogue IDs/);
});

test('falls back to inherited model when no faster documented override is supported', () => {
  const selected = selectRefereeModel({
    provider: 'antigravity',
    supportedModelOptions: ['inherit', 'pro'],
  });

  assert.equal(selected.model, 'inherit');
  assert.equal(selected.explicit, false);
  assert.equal(selected.executionPath, 'inherit');
});

test('selects a Codex child model only when advertised metadata supports the task', () => {
  const selected = selectRefereeModel({
    provider: 'codex',
    supportedModelOptions: [
      { id: 'model-slow', speed: 'slow', cost: 'higher', rulesChecking: 'sufficient' },
      { id: 'model-fast-low', speed: 'fast', cost: 'lower', rulesChecking: 'sufficient' },
    ],
  });

  assert.equal(selected.model, 'model-fast-low');
  assert.equal(selected.explicit, true);
  assert.equal(selected.executionPath, 'native-delegation');
  assert.match(
    selected.instruction,
    /Host metadata identifies it as fast, lower-cost and sufficient/,
  );
});

test('does not guess performance from an unsupported advertised model ID', () => {
  const selected = selectRefereeModel({
    provider: 'codex',
    supportedModelOptions: [{ id: 'fast-model' }],
  });

  assert.equal(selected.model, 'inherit');
  assert.equal(selected.explicit, false);
  assert.equal(selected.executionPath, 'inherit');
});

test('keeps local referee selection on the configured local model', () => {
  const selected = selectRefereeModel({
    provider: 'ollama',
    localModel: 'qwen3.5:14b',
    supportedModelOptions: ['flash_lite', 'pro'],
  });

  assert.equal(selected.model, 'qwen3.5:14b');
  assert.equal(selected.explicit, true);
  assert.equal(selected.executionPath, 'local');
  assert.match(selected.instruction, /Do not switch to a hosted provider/);
});

test('local mode without model metadata inherits locally and ignores hosted options', () => {
  const selected = selectRefereeModel({
    provider: 'ollama',
    supportedModelOptions: ['flash_lite', 'pro'],
  });

  assert.equal(selected.model, 'inherit');
  assert.equal(selected.explicit, false);
  assert.equal(selected.executionPath, 'local');
  assert.match(selected.instruction, /configured local provider/);
});
