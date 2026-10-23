import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { access, chmod, copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pipeline } from 'node:stream/promises';

const MODEL_REPO = 'gradium/phonon-40m-en';
const MODEL_REVISION = 'cc738b7e4d182c2ba1bafb8062aa4846af000637';
const VOICE_REPO = 'gradium/phonon-voices';
const VOICE_REVISION = 'da6c9ec0d47be8df5c87c730a3aa97187f3229c3';
const RELEASE = '0.4.0';
const ARCHIVE_NAME = `ptts-${RELEASE}-aarch64-apple-darwin.tar.gz`;
const ARCHIVE_SHA256 = '7b26c8b9d98f5b5894de09af2aad35e64827e8475c07b003557cafc1ebba6a40';
const ARCHIVE_URL = `https://github.com/gradium-ai/xn-ptts/releases/download/v${RELEASE}/${ARCHIVE_NAME}`;
const FILES = [
  'model/config.json',
  'model/tokenizer.json',
  'model/model.q8.gguf',
  'model/default-voice.safetensors',
  'voices/Easton.safetensors',
  'voices/Zoey.safetensors',
  'voices/voices.jsonl',
  'voices/selected-voices.jsonl',
];

async function sha256(path) {
  return createHash('sha256')
    .update(await readFile(path))
    .digest('hex');
}

async function run(command, args, cwd) {
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: 'ignore' });
    child.once('error', () => reject(new Error('Could not unpack the Phonon runtime.')));
    child.once('exit', (code) =>
      code === 0 ? resolve() : reject(new Error('Could not unpack the Phonon runtime.')),
    );
  });
}

async function runtimeArchive(workDir) {
  const provided = process.env.DM_SPEECH_PTTS_ARCHIVE;
  if (provided) {
    if ((await sha256(provided)) !== ARCHIVE_SHA256)
      throw new Error('The supplied Phonon archive did not match its pinned SHA-256.');
    return provided;
  }
  const archive = join(workDir, ARCHIVE_NAME);
  const response = await fetch(ARCHIVE_URL, { signal: AbortSignal.timeout(120_000) });
  if (!response.ok || !response.body)
    throw new Error('Could not download the pinned Phonon runtime.');
  await pipeline(response.body, createWriteStream(archive, { mode: 0o600 }));
  if ((await sha256(archive)) !== ARCHIVE_SHA256)
    throw new Error('The downloaded Phonon runtime did not match its pinned SHA-256.');
  return archive;
}

/** Stage the pinned macOS arm64 runtime and already prepared, pinned model assets. */
export async function prepareSpeechBundle({
  sourceRoot = process.cwd(),
  destination = join(sourceRoot, 'build', 'desktop-speech'),
  speechHome = process.env.DM_SPEECH_HOME ?? join(homedir(), '.cache', 'dungeon-master', 'speech'),
  platform = process.platform,
  arch = process.arch,
} = {}) {
  if (platform !== 'darwin' || arch !== 'arm64')
    throw new Error('Bundled Phonon currently supports macOS arm64 only.');
  let assets;
  try {
    assets = JSON.parse(await readFile(join(speechHome, 'speech-assets.json'), 'utf8'));
    for (const relative of [...FILES, 'model/README.md']) await access(join(speechHome, relative));
    for (const name of ['CC-BY-NC-4.0.txt', 'NOTICE.md', 'Apache-2.0.txt'])
      await access(join(sourceRoot, 'licenses', 'phonon', name));
  } catch {
    throw new Error(
      'Prepared Phonon files are incomplete. Run npm run speech:setup after accepting its license, then retry packaging.',
    );
  }
  if (
    assets.model_repo !== MODEL_REPO ||
    assets.model_revision !== MODEL_REVISION ||
    assets.voice_repo !== VOICE_REPO ||
    assets.voice_revision !== VOICE_REVISION
  ) {
    throw new Error('Prepared Phonon assets do not match the pinned model and voice revisions.');
  }

  const scratch = await mkdtemp(join(tmpdir(), 'dm-package-phonon-'));
  try {
    const archive = await runtimeArchive(scratch);
    const extracted = join(scratch, 'extract');
    await mkdir(extracted, { recursive: true });
    await run('tar', ['-xzf', archive, '-C', extracted], scratch);
    const runtimeDir = join(extracted, `ptts-${RELEASE}-aarch64-apple-darwin`);
    const binary = join(runtimeDir, 'ptts');
    if ((await sha256(archive)) !== ARCHIVE_SHA256)
      throw new Error('Phonon archive checksum changed during staging.');
    await rm(destination, { recursive: true, force: true });
    await mkdir(join(destination, 'bin'), { recursive: true });
    await mkdir(join(destination, 'licenses'), { recursive: true });
    for (const relative of FILES) {
      const target = join(destination, relative);
      await mkdir(dirname(target), { recursive: true });
      await copyFile(join(speechHome, relative), target);
    }
    await copyFile(join(speechHome, 'model', 'README.md'), join(destination, 'model', 'README.md'));
    await copyFile(binary, join(destination, 'bin', 'ptts'));
    await chmod(join(destination, 'bin', 'ptts'), 0o755);
    await copyFile(join(runtimeDir, 'LICENSE-MIT'), join(destination, 'licenses', 'PTTS-MIT.txt'));
    await copyFile(
      join(runtimeDir, 'LICENSE-APACHE'),
      join(destination, 'licenses', 'PTTS-APACHE-2.0.txt'),
    );
    for (const name of ['CC-BY-NC-4.0.txt', 'NOTICE.md', 'Apache-2.0.txt']) {
      await copyFile(
        join(sourceRoot, 'licenses', 'phonon', name),
        join(destination, 'licenses', name),
      );
    }
    await writeFile(
      join(destination, 'speech-assets.json'),
      `${JSON.stringify(
        {
          model_repo: MODEL_REPO,
          model_revision: MODEL_REVISION,
          voice_repo: VOICE_REPO,
          voice_revision: VOICE_REVISION,
          phonon_cli_version: RELEASE,
          platform: 'darwin-arm64',
          runtime_archive: ARCHIVE_NAME,
          runtime_archive_sha256: ARCHIVE_SHA256,
          runtime_source: 'https://github.com/gradium-ai/xn-ptts/releases/tag/v0.4.0',
        },
        null,
        2,
      )}\n`,
    );
    return { included: true, destination, archiveSha256: ARCHIVE_SHA256 };
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  try {
    const result = await prepareSpeechBundle();
    console.log(`Staged optional Phonon speech in ${result.destination}`);
  } catch (error) {
    console.error(
      error instanceof Error ? error.message : 'Could not stage optional Phonon speech.',
    );
    process.exitCode = 1;
  }
}
