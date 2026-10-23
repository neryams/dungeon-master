import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import {
  chmod,
  copyFile,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { pipeline } from 'node:stream/promises';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const appDir = join(root, 'build/desktop-app');
const runtimeDir = join(root, 'build/desktop-node');
export const NODE_VERSION = '22.23.3';
export const NODE_SHA256 = '72d5d8832b41c9d9646197af614ffd751406ea4d215060eb91b98864e1919a3e';
const nodeArchive = `node-v${NODE_VERSION}-darwin-arm64.tar.xz`;
const nodeUrl = `https://nodejs.org/download/release/v${NODE_VERSION}/${nodeArchive}`;

export const APP_FILES = [
  'README.md',
  'LICENSE',
  'THIRD_PARTY_NOTICES.md',
  'package.json',
  'package-lock.json',
  'plugin.json',
  'dist',
  'build/desktop',
  'skills',
  'examples',
  'rules',
  'licenses',
];
export const PLUGIN_DOCS = [
  'docs/desktop.md',
  'docs/installation.md',
  'docs/rules-coverage.md',
  'docs/tools.md',
  'docs/cloud.md',
];

function assertTarget() {
  if (process.platform !== 'darwin' || process.arch !== 'arm64')
    throw new Error('The initial desktop installer target is macOS on Apple silicon.');
}

async function downloadNode(destination) {
  const temporary = join(tmpdir(), `dm-node-${process.pid}-${Date.now()}.tar.xz`);
  try {
    const response = await fetch(nodeUrl, { redirect: 'error' });
    if (!response.ok || !response.body)
      throw new Error(`Could not download the pinned Node.js runtime (${response.status}).`);
    await pipeline(response.body, createWriteStream(temporary, { mode: 0o600 }));
    const digest = createHash('sha256')
      .update(await readFile(temporary))
      .digest('hex');
    if (digest !== NODE_SHA256)
      throw new Error(`The downloaded Node.js archive failed its SHA-256 check (${digest}).`);
    const extraction = await mkdtemp(join(tmpdir(), 'dm-node-extract-'));
    try {
      execFileSync('tar', ['-xJf', temporary, '-C', extraction, '--strip-components=1'], {
        stdio: 'ignore',
      });
      const binary = join(destination, 'bin/node');
      await mkdir(dirname(binary), { recursive: true });
      await copyFile(join(extraction, 'bin/node'), binary);
      await chmod(binary, 0o755);
      await copyFile(join(extraction, 'LICENSE'), join(destination, 'LICENSE'));
    } finally {
      await rm(extraction, { recursive: true, force: true });
    }
  } finally {
    await rm(temporary, { force: true });
  }
}

async function stageApp() {
  await rm(appDir, { recursive: true, force: true });
  await mkdir(appDir, { recursive: true });
  for (const path of APP_FILES) {
    try {
      await cp(join(root, path), join(appDir, path), { recursive: true });
    } catch (error) {
      if (path === 'THIRD_PARTY_NOTICES.md' && error.code === 'ENOENT')
        throw new Error('THIRD_PARTY_NOTICES.md must be present before packaging.');
      throw error;
    }
  }
  for (const path of PLUGIN_DOCS) {
    await mkdir(join(appDir, 'docs'), { recursive: true });
    await copyFile(join(root, path), join(appDir, path));
  }
  // Speech inference is optional; only the small local sidecar source ships with the app.
  try {
    await mkdir(join(appDir, 'scripts'), { recursive: true });
    await copyFile(
      join(root, 'scripts/phonon-speech.py'),
      join(appDir, 'scripts/phonon-speech.py'),
    );
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  execFileSync('npm', ['ci', '--omit=dev', '--no-audit', '--no-fund'], {
    cwd: appDir,
    stdio: 'inherit',
    env: { ...process.env, npm_config_audit: 'false', npm_config_fund: 'false' },
  });
  await rm(join(appDir, 'package-lock.json'), { force: true });
  const packages = [];
  async function collect(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
      const path = join(directory, entry.name);
      if (entry.name === 'node_modules') {
        await collect(path);
        continue;
      }
      if (entry.name.startsWith('@')) {
        await collect(path);
        continue;
      }
      try {
        const metadata = JSON.parse(await readFile(join(path, 'package.json'), 'utf8'));
        if (typeof metadata.name === 'string' && typeof metadata.version === 'string')
          packages.push({
            name: metadata.name,
            version: metadata.version,
            license: metadata.license ?? 'unspecified',
          });
      } catch (error) {
        if (error.code !== 'ENOENT' && error.code !== 'ENOTDIR') throw error;
      }
      await collect(path);
    }
  }
  await collect(join(appDir, 'node_modules'));
  packages.sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));
  await writeFile(
    join(appDir, 'THIRD_PARTY_PACKAGES.json'),
    `${JSON.stringify(packages, null, 2)}\n`,
  );
}

async function prepare() {
  assertTarget();
  await stageApp();
  await rm(runtimeDir, { recursive: true, force: true });
  await mkdir(runtimeDir, { recursive: true });
  await downloadNode(runtimeDir);
  const node = join(runtimeDir, 'bin/node');
  const output = execFileSync(node, ['--version'], { encoding: 'utf8' }).trim();
  if (output !== `v${NODE_VERSION}`)
    throw new Error(`Pinned Node runtime reported ${output}, expected v${NODE_VERSION}.`);
  console.log(`Staged app payload at ${appDir} with Node.js ${output}.`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await prepare();
