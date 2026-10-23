import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm, readFile, access, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { CampaignStore } from '../dist/store.js';
const run = promisify(execFile);
test('CLI initializes an explicitly bound plugin and portable restore', async (t) => {
  const parent = await mkdtemp(join(tmpdir(), 'dm-cli-'));
  const canonicalParent = await realpath(parent);
  t.after(() => rm(parent, { recursive: true, force: true }));
  const { stdout } = await run(
    process.execPath,
    ['dist/cli.js', 'init', 'example', '--parent', parent, '--name', 'Example'],
    { env: { ...process.env, PATH: '' } },
  );
  const result = JSON.parse(stdout),
    root = result.campaign;
  assert.equal(root, join(canonicalParent, 'example'));
  assert.equal((await (await CampaignStore.open(root)).read()).state.reviewMode, 'setup');
  const mcp = JSON.parse(await readFile(join(root, '.dm/plugin/mcp.json'), 'utf8'));
  assert.deepEqual(mcp.mcpServers['dungeon-master'].args.slice(-2), ['--campaign', root]);
  await access(join(root, '.dm/plugin/skills/run-campaign/SKILL.md'));
  await access(join(root, '.git'));
  assert.equal(await readFile(join(root, '.git/HEAD'), 'utf8'), 'ref: refs/heads/main\n');
  const cfg = await readFile(join(root, '.codex/config.toml'), 'utf8');
  assert.match(cfg, /enabled = true/);
  const check = await run(process.execPath, ['dist/cli.js', 'validate', '--campaign', root]);
  assert.equal(JSON.parse(check.stdout).valid, true);
  await assert.rejects(run(process.execPath, ['dist/cli.js', 'setup', '--campaign', root]));
  assert.equal(await readFile(join(root, '.codex/config.toml'), 'utf8'), cfg);
  await run(process.execPath, [
    'dist/cli.js',
    'export',
    '--campaign',
    root,
    '--output',
    join(canonicalParent, 'backup.json'),
  ]);
  await run(
    process.execPath,
    [
      'dist/cli.js',
      'import',
      join(parent, 'backup.json'),
      '--campaign',
      join(canonicalParent, 'restored'),
    ],
    { env: { ...process.env, PATH: '' } },
  );
  await access(join(canonicalParent, 'restored/.dm/plugin/mcp.json'));
});
