import { access, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { _electron } from 'playwright-core';

const smokeArgs = process.argv.slice(2);
const appBundle = resolve(
  smokeArgs.find((arg) => !arg.startsWith('--')) ?? 'release/mac-arm64/Dungeon Master.app',
);
const resources = join(appBundle, 'Contents/Resources');
const appDir = join(resources, 'app');
const node = join(resources, 'node/bin/node');

function run(binary, args, options = {}) {
  const result = spawnSync(binary, args, { encoding: 'utf8', ...options });
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(`${binary} ${args.join(' ')} failed:\n${result.stderr || result.stdout}`);
  return result.stdout.trim();
}

async function main() {
  const version = run(node, ['--version']);
  if (version !== 'v22.23.3') throw new Error(`Unexpected bundled runtime: ${version}`);
  const architecture = run(node, ['-p', 'process.arch']);
  if (architecture !== 'arm64')
    throw new Error(`Unexpected bundled runtime architecture: ${architecture}`);
  try {
    await access(join(resources, 'speech'));
    throw new Error('Packaged app unexpectedly contains a speech model resource bundle.');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  for (const path of [
    'scripts/package-speech.mjs',
    'scripts/setup-speech.mjs',
    'scripts/phonon-speech.py',
  ]) {
    try {
      await access(join(appDir, path));
      throw new Error(`Packaged app unexpectedly contains obsolete speech tooling: ${path}`);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  for (const name of ['speech-install', 'speech-runtime']) {
    for (const extension of ['js', 'js.map', 'd.ts', 'd.ts.map']) {
      const path = join(appDir, 'dist/desktop', `${name}.${extension}`);
      try {
        await access(path);
        throw new Error(`Packaged app unexpectedly contains obsolete speech output: ${path}`);
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
    }
  }
  try {
    await access(join(appDir, 'gemini-credentials.bin'));
    throw new Error('Packaged app unexpectedly contains a Gemini credential file.');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  run(node, ['dist/cli.js', '--help'], { cwd: appDir });
  run(
    node,
    [
      '--input-type=module',
      '-e',
      "import sharp from 'sharp'; const image = await sharp({ create: { width: 1, height: 1, channels: 4, background: '#000' } }).png().toBuffer(); if (image.length < 8) throw new Error('sharp failed');",
    ],
    { cwd: appDir },
  );

  const temporary = await mkdtemp(join(tmpdir(), 'dm-packaged-smoke-'));
  try {
    // A fresh profile with no external tools, cached models or inherited credentials.
    const cleanEnvironment = {
      HOME: temporary,
      TMPDIR: temporary,
      PATH: dirname(node),
      LANG: 'en_US.UTF-8',
      DM_DESKTOP_USER_DATA: join(temporary, 'isolated-profile'),
    };
    const hostUrl = pathToFileURL(join(appDir, 'dist/desktop/host.js')).href;
    const createSmoke = `import { DesktopHost } from ${JSON.stringify(hostUrl)}; const host = new DesktopHost({ source: ${JSON.stringify(appDir)} }); try { const created = await host.create({ parent: ${JSON.stringify(join(temporary, 'campaigns'))}, slug: 'smoke-campaign', name: 'Smoke Campaign', edition: '2024' }); if (created.campaign?.id !== 'smoke-campaign' || created.reviewMode !== 'setup' || created.revision !== 1) throw new Error('Packaged campaign creation returned an unexpected snapshot'); console.log(JSON.stringify({ campaign: created.campaign, revision: created.revision, reviewMode: created.reviewMode })); } finally { await host.close(); }`;
    run(node, ['--input-type=module', '-e', createSmoke], { env: cleanEnvironment });

    if (smokeArgs.includes('--launch')) {
      const executable = join(appBundle, 'Contents/MacOS/Dungeon Master');
      const app = await _electron.launch({
        executablePath: executable,
        args: [],
        timeout: 20000,
        env: cleanEnvironment,
      });
      try {
        const page = await app.firstWindow();
        await page.waitForSelector('#create-form', { timeout: 20000 });
        const snapshot = await page.evaluate(() => window.table.snapshot());
        if (snapshot.campaign !== null || snapshot.stage !== 'disconnected')
          throw new Error('Packaged Electron worker returned an unexpected initial snapshot.');
        console.log('Packaged Electron UI rendered and its bundled Node worker answered IPC.');
      } finally {
        await app.close();
      }
    }
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
  console.log(`Packaged app smoke passed: ${appBundle}`);
}

await main();
