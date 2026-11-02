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
export const NODE_WIN_X64_SHA256 =
  '2b0ff57b049cda1bbcea2240eec20467018713c1efe1f7360c2681859b90ed71';

const NODE_TARGETS = {
  'darwin-arm64': {
    archive: `node-v${NODE_VERSION}-darwin-arm64.tar.xz`,
    sha256: NODE_SHA256,
    extractedBinary: 'bin/node',
    stagedBinary: 'bin/node',
    tarFlags: '-xJf',
  },
  'win32-x64': {
    archive: `node-v${NODE_VERSION}-win-x64.zip`,
    sha256: NODE_WIN_X64_SHA256,
    extractedBinary: 'node.exe',
    stagedBinary: 'bin/node.exe',
    tarFlags: '-xf',
  },
};

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
];
export const PLUGIN_DOCS = [
  'docs/desktop.md',
  'docs/installation.md',
  'docs/rules-coverage.md',
  'docs/tools.md',
  'docs/cloud.md',
];

function resolveTarget(platform = process.platform, arch = process.arch) {
  const target = NODE_TARGETS[`${platform}-${arch}`];
  if (!target)
    throw new Error(
      `Desktop installer packaging supports macOS arm64 (darwin-arm64) and Windows x64 (win32-x64); got ${platform}-${arch}.`,
    );
  return target;
}

async function downloadNode(destination, target = resolveTarget()) {
  const url = `https://nodejs.org/download/release/v${NODE_VERSION}/${target.archive}`;
  const temporary = join(tmpdir(), `dm-node-${process.pid}-${Date.now()}-${target.archive}`);
  try {
    const response = await fetch(url, { redirect: 'error' });
    if (!response.ok || !response.body)
      throw new Error(`Could not download the pinned Node.js runtime (${response.status}).`);
    await pipeline(response.body, createWriteStream(temporary, { mode: 0o600 }));
    const digest = createHash('sha256')
      .update(await readFile(temporary))
      .digest('hex');
    if (digest !== target.sha256)
      throw new Error(`The downloaded Node.js archive failed its SHA-256 check (${digest}).`);
    const extraction = await mkdtemp(join(tmpdir(), 'dm-node-extract-'));
    try {
      execFileSync('tar', [target.tarFlags, temporary, '-C', extraction, '--strip-components=1'], {
        stdio: 'ignore',
      });
      const binary = join(destination, target.stagedBinary);
      await mkdir(dirname(binary), { recursive: true });
      await copyFile(join(extraction, target.extractedBinary), binary);
      await chmod(binary, 0o755);
      await copyFile(join(extraction, 'LICENSE'), join(destination, 'LICENSE'));
    } finally {
      await rm(extraction, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    }
  } finally {
    await rm(temporary, { force: true });
  }
}

async function stageApp() {
  await rm(appDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
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
  // TypeScript does not remove outputs for deleted sources; strip legacy Phonon artifacts.
  for (const extension of ['js', 'js.map', 'd.ts', 'd.ts.map']) {
    for (const name of ['speech-install', 'speech-runtime']) {
      await rm(join(appDir, 'dist/desktop', `${name}.${extension}`), { force: true });
    }
  }
  const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  execFileSync(npmCmd, ['ci', '--omit=dev', '--no-audit', '--no-fund'], {
    cwd: appDir,
    stdio: 'inherit',
    shell: process.platform === 'win32',
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
  const target = resolveTarget();
  await stageApp();
  await rm(runtimeDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  await mkdir(runtimeDir, { recursive: true });
  await downloadNode(runtimeDir, target);
  const node = join(runtimeDir, target.stagedBinary);
  const output = execFileSync(node, ['--version'], { encoding: 'utf8' }).trim();
  if (output !== `v${NODE_VERSION}`)
    throw new Error(`Pinned Node runtime reported ${output}, expected v${NODE_VERSION}.`);
  console.log(`Staged app payload at ${appDir} with Node.js ${output}.`);

  if (process.argv.includes('--dist')) {
    const builderBin = join(
      root,
      'node_modules',
      '.bin',
      process.platform === 'win32' ? 'electron-builder.cmd' : 'electron-builder',
    );
    const builderArgs =
      process.platform === 'win32'
        ? [
            '--config',
            'electron-builder.config.cjs',
            '--win',
            'nsis',
            'zip',
            '--x64',
            '--publish',
            'never',
          ]
        : [
            '--config',
            'electron-builder.config.cjs',
            '--mac',
            'dmg',
            'zip',
            '--arm64',
            '--publish',
            'never',
          ];
    execFileSync(builderBin, builderArgs, {
      cwd: root,
      stdio: 'inherit',
      shell: process.platform === 'win32',
    });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await prepare();
