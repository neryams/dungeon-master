import { mkdtemp, rm } from 'node:fs/promises';
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
      HF_HOME: join(temporary, 'empty-hugging-face'),
      HF_HUB_OFFLINE: '1',
      DM_BUNDLED_SPEECH: join(resources, 'speech'),
      DM_SPEECH_HOME: join(temporary, 'isolated-speech'),
      DM_DESKTOP_USER_DATA: join(temporary, 'isolated-profile'),
    };
    const hostUrl = pathToFileURL(join(appDir, 'dist/desktop/host.js')).href;
    const createSmoke = `import { DesktopHost } from ${JSON.stringify(hostUrl)}; const host = new DesktopHost({ source: ${JSON.stringify(appDir)} }); try { const created = await host.create({ parent: ${JSON.stringify(join(temporary, 'campaigns'))}, slug: 'smoke-campaign', name: 'Smoke Campaign', edition: '2024' }); if (created.campaign?.id !== 'smoke-campaign' || created.reviewMode !== 'setup' || created.revision !== 1) throw new Error('Packaged campaign creation returned an unexpected snapshot'); console.log(JSON.stringify({ campaign: created.campaign, revision: created.revision, reviewMode: created.reviewMode })); } finally { await host.close(); }`;
    run(node, ['--input-type=module', '-e', createSmoke], { env: cleanEnvironment });

    const runtimeUrl = pathToFileURL(join(appDir, 'dist/desktop/speech-runtime.js')).href;
    const installerUrl = pathToFileURL(join(appDir, 'dist/desktop/speech-install.js')).href;
    const narrationSmoke = `
      import { SpeechRuntime } from ${JSON.stringify(runtimeUrl)};
      import { SpeechInstaller, PHONON_LICENSE_REVISION } from ${JSON.stringify(installerUrl)};
      const installer = new SpeechInstaller({sourceRoot: ${JSON.stringify(appDir)}});
      const runtime = new SpeechRuntime({sourceRoot: ${JSON.stringify(appDir)}});
      try {
        const before = await installer.status();
        if (!before.bundled || before.accepted) throw new Error('Expected fresh bundled consent');
        await installer.install({accepted:true, licenseRevision:PHONON_LICENSE_REVISION});
        let state;
        for (let attempt=0; attempt<100; attempt++) {
          state = await installer.status();
          if(state.phase !== 'installing') break;
          await new Promise(resolve => setTimeout(resolve, 50));
        }
        if(state.phase !== 'ready') throw new Error('Bundled speech did not become ready');
        for (const voice of ['Easton', 'Zoey']) {
          const wav=Buffer.from(await runtime.synthesize('The lantern shines beside the ancient gate.', voice), 'base64');
          if(wav.length <= 44 || wav.toString('ascii',0,4)!=='RIFF' || wav.toString('ascii',8,12)!=='WAVE') throw new Error('Invalid speech audio');
          console.log(voice + ' bundled offline narration: ' + wav.length + ' bytes');
        }
        await installer.decline();
      } finally { runtime.close(); installer.close(); }
    `;
    console.log(
      run(node, ['--input-type=module', '-e', narrationSmoke], {
        env: cleanEnvironment,
        timeout: 180000,
      }),
    );
    // The UI must start with its own untouched consent state.
    await rm(cleanEnvironment.DM_SPEECH_HOME, { recursive: true, force: true });

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
        await page.locator('#speech-dialog').waitFor({ state: 'visible', timeout: 20000 });
        if (!(await page.locator('#speech-token-label').isHidden()))
          throw new Error('Packaged narration must not request Hugging Face credentials.');
        await page.locator('#speech-close').click();
        await page.waitForFunction(
          async () => (await window.table.speechSetupStatus()).phase === 'declined',
          undefined,
          { timeout: 20000 },
        );
        await page.locator('#speech-dialog').waitFor({ state: 'hidden', timeout: 20000 });
        await page.locator('#speech-settings').click();
        await page.locator('#speech-consent').check();
        await page.locator('#speech-install').click();
        await page.waitForFunction(
          async () => (await window.table.speechSetupStatus()).phase === 'ready',
          undefined,
          { timeout: 20000 },
        );
        await page.locator('#speech-close').click();
        await page.locator('#speech-dialog').waitFor({ state: 'hidden', timeout: 20000 });
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
