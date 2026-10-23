import { createHash } from 'node:crypto';
import { spawn as nodeSpawn, type ChildProcess } from 'node:child_process';
import { access, cp, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const PHONON_LICENSE_REVISION = 'phonon-40m-cc-by-nc-4.0-2026-10-22';

export interface SpeechInstallState {
  phase: 'unconfigured' | 'declined' | 'installing' | 'ready' | 'error';
  detail: string;
  accepted: boolean;
  licenseRevision: string;
}

export interface SpeechInstallerOptions {
  home?: string;
  sourceRoot?: string;
  platform?: NodeJS.Platform;
  arch?: string;
  fetch?: typeof globalThis.fetch;
  spawn?: typeof nodeSpawn;
}

type ConsentReceipt = { licenseRevision: string; acceptedAt: string };
type InstallDecision = {
  licenseRevision: string;
  decision: 'accepted' | 'declined';
  decidedAt: string;
};
type PlatformAsset = { filename: string; sha256: string; member: string };

const UV_VERSION = '0.13.5';
const MAX_UV_ARCHIVE_BYTES = 100 * 1024 * 1024;
const DOWNLOAD_TIMEOUT_MS = 120_000;
const PROCESS_TIMEOUT_MS = 30 * 60_000;
const UV_ASSETS: Record<string, PlatformAsset> = {
  'darwin-arm64': {
    filename: 'uv-aarch64-apple-darwin.tar.gz',
    sha256: '743f85035a1996ecb350659e01cd9faea9709829be09b1b4b03c73eaf3c9cd73',
    member: 'uv-aarch64-apple-darwin/uv',
  },
  'darwin-x64': {
    filename: 'uv-x86_64-apple-darwin.tar.gz',
    sha256: 'b0f52b0e3945b4107d89024ea38e625683011fbfc05a0d98f9fa2d6dcee28c66',
    member: 'uv-x86_64-apple-darwin/uv',
  },
};

const READY_FILES = [
  'venv/bin/python',
  'model/config.json',
  'model/README.md',
  'model/tokenizer.json',
  'model/model.q8.gguf',
  'voices/selected-voices.jsonl',
  'voices/Easton.safetensors',
  'voices/Zoey.safetensors',
  'speech-assets.json',
];

/** Installs optional local narration only after an explicit, versioned license acceptance. */
export class SpeechInstaller {
  private readonly home: string;
  private readonly sourceRoot: string;
  private readonly platform: NodeJS.Platform;
  private readonly arch: string;
  private readonly fetcher: typeof globalThis.fetch;
  private readonly spawnProcess: typeof nodeSpawn;
  private state: SpeechInstallState = {
    phase: 'unconfigured',
    detail: 'Optional local narration has not been installed.',
    accepted: false,
    licenseRevision: PHONON_LICENSE_REVISION,
  };
  private child: ChildProcess | undefined;
  private readonly killTimers = new WeakMap<ChildProcess, NodeJS.Timeout>();
  private readonly terminatingChildren = new WeakSet<ChildProcess>();
  private downloadController: AbortController | undefined;
  private decisionWrite: Promise<void> = Promise.resolve();
  private taskTail: Promise<void> = Promise.resolve();
  private closed = false;
  private generation = 0;

  constructor(options: SpeechInstallerOptions = {}) {
    this.home =
      options.home ??
      process.env.DM_SPEECH_HOME ??
      join(homedir(), '.cache', 'dungeon-master', 'speech');
    this.sourceRoot = options.sourceRoot ?? fileURLToPath(new URL('../..', import.meta.url));
    this.platform = options.platform ?? process.platform;
    this.arch = options.arch ?? process.arch;
    this.fetcher = options.fetch ?? globalThis.fetch;
    this.spawnProcess = options.spawn ?? nodeSpawn;
  }

  async status(): Promise<SpeechInstallState> {
    if (this.closed)
      return {
        phase: 'unconfigured',
        detail: 'Optional local narration is unavailable.',
        accepted: false,
        licenseRevision: PHONON_LICENSE_REVISION,
      };
    if (this.state.phase === 'installing') return { ...this.state };
    const generation = this.generation;
    await this.decisionWrite.catch(() => {});
    if (!this.isCurrent(generation)) return this.currentState();
    const decision = await this.readDecision();
    if (!this.isCurrent(generation)) return this.currentState();
    if (decision?.licenseRevision === PHONON_LICENSE_REVISION && decision.decision === 'declined') {
      this.state = {
        phase: 'declined',
        detail: 'Local narration was declined. The app remains playable.',
        accepted: false,
        licenseRevision: PHONON_LICENSE_REVISION,
      };
      return { ...this.state };
    }
    const receipt = await this.readReceipt();
    if (!this.isCurrent(generation)) return this.currentState();
    const accepted =
      decision?.licenseRevision === PHONON_LICENSE_REVISION &&
      decision.decision === 'accepted' &&
      receipt?.licenseRevision === PHONON_LICENSE_REVISION;
    if (!accepted) {
      if (this.state.phase === 'declined') return { ...this.state, accepted: false };
      return {
        phase: 'unconfigured',
        detail: 'Optional local narration has not been installed.',
        accepted: false,
        licenseRevision: PHONON_LICENSE_REVISION,
      };
    }
    const ready = await this.assetsReady();
    if (!this.isCurrent(generation)) return this.currentState();
    if (ready) {
      this.state = {
        phase: 'ready',
        detail: 'Phonon 40M local narration is ready.',
        accepted: true,
        licenseRevision: PHONON_LICENSE_REVISION,
      };
      return { ...this.state };
    }
    if (this.state.phase === 'error') return { ...this.state, accepted: true };
    return {
      phase: 'unconfigured',
      detail: 'Phonon 40M is approved but not installed yet.',
      accepted: true,
      licenseRevision: PHONON_LICENSE_REVISION,
    };
  }

  async install(input: {
    accepted: true;
    licenseRevision: string;
    token?: string;
  }): Promise<SpeechInstallState> {
    if (this.closed) return this.status();
    if (input.accepted !== true || input.licenseRevision !== PHONON_LICENSE_REVISION) {
      this.generation += 1;
      this.state = {
        phase: 'error',
        detail: 'Review and accept the current Phonon 40M license before installing.',
        accepted: false,
        licenseRevision: PHONON_LICENSE_REVISION,
      };
      return { ...this.state };
    }
    if (this.state.phase === 'installing') return { ...this.state };

    const generation = ++this.generation;
    this.state = {
      phase: 'installing',
      detail: 'Preparing local narration…',
      accepted: true,
      licenseRevision: PHONON_LICENSE_REVISION,
    };
    const task = this.taskTail
      .catch(() => {})
      .then(() => this.installInBackground(generation, input.token));
    this.taskTail = task.catch(() => {});
    return { ...this.state };
  }

  async decline(): Promise<SpeechInstallState> {
    this.generation += 1;
    this.downloadController?.abort();
    this.downloadController = undefined;
    this.killChild();
    this.state = {
      phase: 'declined',
      detail: 'Local narration was declined. The app remains playable.',
      accepted: false,
      licenseRevision: PHONON_LICENSE_REVISION,
    };
    await this.queueDecisionWrite(async () => {
      await this.writeDecision('declined');
      await rm(this.receiptPath(), { force: true });
    });
    return { ...this.state };
  }

  async cancel(): Promise<SpeechInstallState> {
    if (this.state.phase !== 'installing') return this.status();
    this.generation += 1;
    this.downloadController?.abort();
    this.downloadController = undefined;
    this.killChild();
    this.state = {
      phase: 'unconfigured',
      detail: 'Narration installation was cancelled. You can retry later.',
      accepted: true,
      licenseRevision: PHONON_LICENSE_REVISION,
    };
    await this.queueDecisionWrite(async () => {
      if (this.state.phase !== 'declined') {
        await this.writeReceipt({
          licenseRevision: PHONON_LICENSE_REVISION,
          acceptedAt: new Date().toISOString(),
        });
        await this.writeDecision('accepted');
      }
    });
    return { ...this.state };
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.generation += 1;
    this.downloadController?.abort();
    this.downloadController = undefined;
    this.killChild();
  }

  private async installInBackground(generation: number, token?: string): Promise<void> {
    try {
      if (!this.isCurrent(generation)) return;
      await mkdir(this.home, { recursive: true });
      if (!this.isCurrent(generation)) return;
      await this.queueDecisionWrite(async () => {
        if (!this.isCurrent(generation)) return;
        await this.writeReceipt({
          licenseRevision: PHONON_LICENSE_REVISION,
          acceptedAt: new Date().toISOString(),
        });
        await this.writeDecision('accepted');
      });
      if (!this.isCurrent(generation)) return;
      if (await this.assetsReady()) {
        if (!this.isCurrent(generation)) return;
        await this.copyLicenseNotices();
        if (!this.isCurrent(generation)) return;
        this.state = {
          phase: 'ready',
          detail: 'Phonon 40M local narration is ready.',
          accepted: true,
          licenseRevision: PHONON_LICENSE_REVISION,
        };
        return;
      }
      const asset = UV_ASSETS[`${this.platform}-${this.arch}`];
      if (!asset) throw new Error('unsupported_platform');
      const uv = await this.ensureUv(asset, generation);
      if (!this.isCurrent(generation)) return;
      this.setDetail(generation, 'Preparing the narration engine…');

      const pythonDir = join(this.home, 'python');
      const cacheDir = join(this.home, 'uv-cache');
      const venv = join(this.home, 'venv');
      const baseEnv = this.bootstrapEnvironment(cacheDir, pythonDir);
      const python = join(venv, 'bin', 'python');
      try {
        await access(python);
      } catch {
        await rm(venv, { recursive: true, force: true });
        await this.run(
          uv,
          ['python', 'install', '--install-dir', pythonDir, '--no-bin', '3.12'],
          baseEnv,
          generation,
        );
        await this.run(
          uv,
          ['venv', '--python', '3.12', '--python-preference', 'only-managed', venv],
          baseEnv,
          generation,
        );
      }
      this.setDetail(generation, 'Preparing the narration engine…');
      await this.run(
        uv,
        [
          'pip',
          'install',
          '--python',
          python,
          'ptts==0.4.1',
          'numpy==2.5.4',
          'huggingface_hub==2.2.0',
        ],
        baseEnv,
        generation,
      );
      this.setDetail(
        generation,
        'Checking access and downloading Phonon 40M and the selected voices…',
      );
      const prepareEnv = this.bootstrapEnvironment(cacheDir, pythonDir, token, true);
      try {
        await this.run(
          python,
          [join(this.sourceRoot, 'scripts', 'phonon-speech.py'), '--prepare', '--home', this.home],
          prepareEnv,
          generation,
        );
      } catch {
        throw new Error('hf_prepare_failed');
      }
      if (generation !== this.generation || this.closed) return;
      const ready = await this.assetsReady();
      if (!this.isCurrent(generation)) return;
      if (!ready) throw new Error('assets_incomplete');
      await this.copyLicenseNotices();
      if (!this.isCurrent(generation)) return;
      this.state = {
        phase: 'ready',
        detail: 'Phonon 40M local narration is ready.',
        accepted: true,
        licenseRevision: PHONON_LICENSE_REVISION,
      };
    } catch (error) {
      if (generation !== this.generation || this.closed) return;
      const detail =
        error instanceof Error && error.message === 'unsupported_platform'
          ? 'Optional narration installation is not available for this computer.'
          : error instanceof Error && error.message === 'hf_prepare_failed'
            ? 'Could not download Phonon 40M. Accept the Hugging Face access conditions for the pinned model and voices, then retry with an approved login.'
            : error instanceof Error && error.message === 'cancelled'
              ? 'Narration installation was cancelled. You can retry later.'
              : 'Narration installation failed. Check your connection and retry.';
      this.state = {
        phase: 'error',
        detail,
        accepted: true,
        licenseRevision: PHONON_LICENSE_REVISION,
      };
    } finally {
      if (generation === this.generation) {
        this.child = undefined;
        this.downloadController = undefined;
      }
    }
  }

  private async ensureUv(asset: PlatformAsset, generation: number): Promise<string> {
    const bootstrap = join(this.home, 'bootstrap');
    const uv = join(bootstrap, 'bin', 'uv');
    try {
      await access(uv);
      return uv;
    } catch {
      // Download and verify the pinned bootstrap before extracting its executable.
    }
    await mkdir(bootstrap, { recursive: true });
    if (!this.isCurrent(generation)) throw new Error('cancelled');
    const url = `https://github.com/astral-sh/uv/releases/download/${UV_VERSION}/${asset.filename}`;
    this.setDetail(generation, 'Downloading components for local narration…');
    const controller = new AbortController();
    this.downloadController = controller;
    let data: Buffer;
    try {
      const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS)]);
      const response = await this.fetcher(url, { signal });
      if (!response.ok || !response.body) throw new Error('download_failed');
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let totalBytes = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        totalBytes += value.byteLength;
        if (totalBytes > MAX_UV_ARCHIVE_BYTES) {
          await reader.cancel();
          throw new Error('download_too_large');
        }
        chunks.push(value);
      }
      data = Buffer.concat(chunks, totalBytes);
    } finally {
      if (this.downloadController === controller) this.downloadController = undefined;
    }
    if (data.length === 0 || createHash('sha256').update(data).digest('hex') !== asset.sha256)
      throw new Error('checksum_failed');
    if (generation !== this.generation) throw new Error('cancelled');
    const archive = join(bootstrap, asset.filename);
    await writeFile(archive, data, { mode: 0o600 });
    if (!this.isCurrent(generation)) throw new Error('cancelled');
    await mkdir(join(bootstrap, 'extract'), { recursive: true });
    if (!this.isCurrent(generation)) throw new Error('cancelled');
    await this.run(
      'tar',
      ['-xzf', archive, '-C', join(bootstrap, 'extract')],
      this.bootstrapEnvironment(),
      generation,
    );
    if (!this.isCurrent(generation)) throw new Error('cancelled');
    const extracted = join(bootstrap, 'extract', asset.member);
    await mkdir(join(bootstrap, 'bin'), { recursive: true });
    await rename(extracted, uv);
    await rm(archive, { force: true });
    await rm(join(bootstrap, 'extract'), { recursive: true, force: true });
    return uv;
  }

  private async run(
    command: string,
    args: string[],
    env: NodeJS.ProcessEnv,
    generation: number,
  ): Promise<void> {
    if (generation !== this.generation || this.closed) throw new Error('cancelled');
    await new Promise<void>((resolve, reject) => {
      let child: ChildProcess;
      try {
        child = this.spawnProcess(command, args, {
          cwd: this.home,
          env,
          stdio: 'ignore',
          windowsHide: true,
          detached: this.platform !== 'win32',
        });
      } catch {
        reject(new Error('process_failed'));
        return;
      }
      this.child = child;
      let settled = false;
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        const killTimer = this.killTimers.get(child);
        if (!this.terminatingChildren.has(child)) {
          if (killTimer) clearTimeout(killTimer);
          this.killTimers.delete(child);
        }
        if (this.child === child) this.child = undefined;
        if (error) reject(error);
        else resolve();
      };
      const timeout = setTimeout(() => {
        this.terminateChild(child);
        finish(new Error('process_timeout'));
      }, PROCESS_TIMEOUT_MS);
      timeout.unref();
      child.once('error', () => {
        finish(new Error('process_failed'));
      });
      child.once('exit', (code) => {
        if (generation !== this.generation || this.closed) finish(new Error('cancelled'));
        else if (code === 0) finish();
        else finish(new Error('process_failed'));
      });
    });
  }

  private killChild(): void {
    const child = this.child;
    this.child = undefined;
    if (child) this.terminateChild(child);
  }

  private terminateChild(child: ChildProcess): void {
    const signal = (name: NodeJS.Signals) => {
      try {
        if (this.platform !== 'win32' && child.pid) process.kill(-child.pid, name);
        else child.kill(name);
      } catch {
        // The owned process may already have exited.
      }
    };
    signal('SIGTERM');
    this.terminatingChildren.add(child);
    const priorTimer = this.killTimers.get(child);
    if (priorTimer) clearTimeout(priorTimer);
    const timer = setTimeout(() => {
      signal('SIGKILL');
      this.killTimers.delete(child);
      this.terminatingChildren.delete(child);
    }, 1_500);
    timer.unref();
    this.killTimers.set(child, timer);
  }

  private bootstrapEnvironment(
    cacheDir = join(this.home, 'uv-cache'),
    pythonDir = join(this.home, 'python'),
    token?: string,
    includeLogin = false,
  ): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = {
      PATH: process.env.PATH ?? '/usr/bin:/bin',
      HOME: homedir(),
      USERPROFILE: homedir(),
      TMPDIR: process.env.TMPDIR,
      TEMP: process.env.TEMP,
      TMP: process.env.TMP,
      UV_CACHE_DIR: cacheDir,
      UV_PYTHON_INSTALL_DIR: pythonDir,
      HF_HUB_CACHE: join(this.home, 'hf-cache'),
      HF_HUB_DISABLE_TELEMETRY: '1',
      PYTHONNOUSERSITE: '1',
      PYTHONDONTWRITEBYTECODE: '1',
    };
    if (process.platform === 'win32') env.SystemRoot = process.env.SystemRoot;
    if (token) env.HF_TOKEN = token;
    else if (includeLogin) {
      // Preserve the user's normal Hugging Face login path for this explicit install only.
      if (process.env.HF_HOME) env.HF_HOME = process.env.HF_HOME;
      if (process.env.HF_TOKEN) env.HF_TOKEN = process.env.HF_TOKEN;
      if (process.env.HF_TOKEN_PATH) env.HF_TOKEN_PATH = process.env.HF_TOKEN_PATH;
    }
    return env;
  }

  private async assetsReady(): Promise<boolean> {
    try {
      await Promise.all(READY_FILES.map((path) => access(join(this.home, path))));
      const assetInfo = JSON.parse(
        await readFile(join(this.home, 'speech-assets.json'), 'utf8'),
      ) as {
        model_revision?: string;
        voice_revision?: string;
      };
      return (
        assetInfo.model_revision === 'cc738b7e4d182c2ba1bafb8062aa4846af000637' &&
        assetInfo.voice_revision === 'da6c9ec0d47be8df5c87c730a3aa97187f3229c3'
      );
    } catch {
      return false;
    }
  }

  private async copyLicenseNotices(): Promise<void> {
    const source = join(this.sourceRoot, 'licenses', 'phonon');
    await cp(source, join(this.home, 'licenses'), { recursive: true, force: true });
  }

  private receiptPath(): string {
    return join(this.home, 'consent.json');
  }

  private decisionPath(): string {
    return join(this.home, 'install-decision.json');
  }

  private async readDecision(): Promise<InstallDecision | undefined> {
    try {
      const parsed = JSON.parse(await readFile(this.decisionPath(), 'utf8')) as InstallDecision;
      if (
        typeof parsed.licenseRevision !== 'string' ||
        (parsed.decision !== 'accepted' && parsed.decision !== 'declined') ||
        typeof parsed.decidedAt !== 'string'
      )
        return undefined;
      return parsed;
    } catch {
      return undefined;
    }
  }

  private async readReceipt(): Promise<ConsentReceipt | undefined> {
    try {
      const parsed = JSON.parse(await readFile(this.receiptPath(), 'utf8')) as ConsentReceipt;
      if (typeof parsed.licenseRevision !== 'string' || typeof parsed.acceptedAt !== 'string')
        return undefined;
      return parsed;
    } catch {
      return undefined;
    }
  }

  private async writeReceipt(receipt: ConsentReceipt): Promise<void> {
    await mkdir(this.home, { recursive: true });
    const temp = `${this.receiptPath()}.tmp`;
    await writeFile(temp, `${JSON.stringify(receipt)}\n`, { mode: 0o600 });
    await rename(temp, this.receiptPath());
  }

  private async writeDecision(decision: 'accepted' | 'declined'): Promise<void> {
    await mkdir(this.home, { recursive: true });
    const payload: InstallDecision = {
      licenseRevision: PHONON_LICENSE_REVISION,
      decision,
      decidedAt: new Date().toISOString(),
    };
    const temp = `${this.decisionPath()}.tmp`;
    await writeFile(temp, `${JSON.stringify(payload)}\n`, { mode: 0o600 });
    await rename(temp, this.decisionPath());
  }

  private queueDecisionWrite(work: () => Promise<void>): Promise<void> {
    const next = this.decisionWrite.catch(() => {}).then(work);
    this.decisionWrite = next;
    return next;
  }

  private isCurrent(generation: number): boolean {
    return generation === this.generation && !this.closed;
  }

  private currentState(): SpeechInstallState {
    if (this.closed) {
      return {
        phase: 'unconfigured',
        detail: 'Optional local narration is unavailable.',
        accepted: false,
        licenseRevision: PHONON_LICENSE_REVISION,
      };
    }
    return { ...this.state };
  }

  private setDetail(generation: number, detail: string): void {
    if (generation === this.generation && !this.closed)
      this.state = {
        phase: 'installing',
        detail,
        accepted: true,
        licenseRevision: PHONON_LICENSE_REVISION,
      };
  }
}
