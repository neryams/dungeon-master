import { cp, mkdir, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { execFileSync } from 'node:child_process';
const root = resolve('build/plugin');
await rm(root, { recursive: true, force: true });
await mkdir(root, { recursive: true });
for (const path of [
  'plugin.json',
  'mcp.json',
  'skills',
  'dist',
  'examples',
  'rules',
  'README.md',
  'LICENSE',
  'docs',
  'package.json',
  'package-lock.json',
  'src',
  'test',
  'scripts',
  'desktop',
  'tsconfig.json',
  'AGENTS.md',
  '.prettierrc.json',
  '.prettierignore',
  '.gitignore',
  '.agents',
  '.github',
])
  await cp(path, join(root, path), { recursive: true });
execFileSync('tar', [
  '-czf',
  resolve('build/dungeon-master-plugin.tgz'),
  '-C',
  resolve('build'),
  'plugin',
]);
console.log(
  JSON.stringify(
    {
      plugin: root,
      archive: resolve('build/dungeon-master-plugin.tgz'),
      note: 'Portable package; install dependencies, build and npm link to expose its binary. Campaign init creates an explicitly bound local plugin.',
    },
    null,
    2,
  ),
);
