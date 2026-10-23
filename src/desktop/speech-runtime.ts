import { spawn as nodeSpawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { access as nodeAccess } from 'node:fs/promises';
import { homedir } from 'node:os';
import { delimiter, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const MAX_TEXT_LENGTH = 2_000;
const MAX_AUDIO_BYTES = 10 * 1024 * 1024;
const MAX_PROTOCOL_LINE = Math.ceil((MAX_AUDIO_BYTES * 4) / 3) + 1024;
const STARTUP_TIMEOUT_MS = 120_000;
const SYNTHESIS_TIMEOUT_MS = 120_000;

type Voice = 'Easton' | 'Zoey';
type Status = { available: boolean; detail: string };
type RuntimeChild = {
  process: ChildProcessWithoutNullStreams;
  startupTimer: NodeJS.Timeout;
  generation: number;
  ready: boolean;
  lineChunks: Buffer[];
  lineBytes: number;
  onReady: (error?: Error) => void;
};
type Pending = {
  id: string;
  generation: number;
  timer: NodeJS.Timeout;
  resolve: (audio: string) => void;
  reject: (error: Error) => void;
};
type Opening = {
  epoch: number;
  promise: Promise<RuntimeChild>;
  cancel: (error: Error) => void;
};

export type SpeechRuntimeOptions = {
  home?: string;
  sourceRoot?: string;
  pythonPath?: string;
  scriptPath?: string;
  spawn?: typeof nodeSpawn;
  startupTimeoutMs?: number;
  synthesisTimeoutMs?: number;
  assetAccess?: typeof nodeAccess;
};

/** Owns the persistent local Phonon process used for Electron narration. */
export class SpeechRuntime {
  private readonly home: string;
  private readonly sourceRoot: string;
  private readonly pythonPath: string;
  private readonly scriptPath: string;
  private readonly spawnProcess: typeof nodeSpawn;
  private readonly startupTimeoutMs: number;
  private readonly synthesisTimeoutMs: number;
  private readonly assetAccess: typeof nodeAccess;
  private child: RuntimeChild | undefined;
  private pending: Pending | undefined;
  private opening: Opening | undefined;
  private activeRequest: { epoch: number } | undefined;
  private nextId = 1;
  private generation = 0;
  private requestEpoch = 0;
  private closed = false;

  constructor(options: SpeechRuntimeOptions = {}) {
    this.home =
      options.home ??
      process.env.DM_SPEECH_HOME ??
      join(homedir(), '.cache', 'dungeon-master', 'speech');
    this.sourceRoot = options.sourceRoot ?? fileURLToPath(new URL('../..', import.meta.url));
    this.pythonPath =
      options.pythonPath ??
      join(
        this.home,
        'venv',
        process.platform === 'win32' ? 'Scripts' : 'bin',
        process.platform === 'win32' ? 'python.exe' : 'python',
      );
    this.scriptPath = options.scriptPath ?? join(this.sourceRoot, 'scripts', 'phonon-speech.py');
    this.spawnProcess = options.spawn ?? nodeSpawn;
    this.startupTimeoutMs = options.startupTimeoutMs ?? STARTUP_TIMEOUT_MS;
    this.synthesisTimeoutMs = options.synthesisTimeoutMs ?? SYNTHESIS_TIMEOUT_MS;
    this.assetAccess = options.assetAccess ?? nodeAccess;
  }

  async status(): Promise<Status> {
    if (this.closed) return { available: false, detail: 'Speech runtime is closed.' };
    const required = [
      this.pythonPath,
      this.scriptPath,
      join(this.home, 'model', 'config.json'),
      join(this.home, 'model', 'model.q8.gguf'),
      join(this.home, 'model', 'tokenizer.json'),
      join(this.home, 'voices', 'selected-voices.jsonl'),
      join(this.home, 'voices', 'Easton.safetensors'),
      join(this.home, 'voices', 'Zoey.safetensors'),
    ];
    try {
      await Promise.all(required.map((path) => this.assetAccess(path)));
      return { available: true, detail: 'Phonon speech is ready.' };
    } catch {
      return {
        available: false,
        detail: 'Narration is not installed on this computer. See the desktop setup guide.',
      };
    }
  }

  async synthesize(text: string, voice: Voice): Promise<string> {
    if (this.closed) throw new Error('Speech runtime is closed.');
    if (typeof text !== 'string' || text.trim().length === 0 || text.length > MAX_TEXT_LENGTH) {
      throw new Error(`Speech text must contain 1–${MAX_TEXT_LENGTH} characters.`);
    }
    if (voice !== 'Easton' && voice !== 'Zoey') throw new Error('Unsupported speech voice.');
    if (this.activeRequest) throw new Error('Speech synthesis is already in progress.');

    const epoch = this.requestEpoch;
    const request = { epoch };
    this.activeRequest = request;
    try {
      const runtime = await this.ensureChild(epoch);
      if (
        this.closed ||
        this.requestEpoch !== epoch ||
        this.activeRequest !== request ||
        this.child !== runtime
      ) {
        throw new Error('Speech request was cancelled.');
      }
      const id = String(this.nextId++);
      return await new Promise<string>((resolve, reject) => {
        const timer = setTimeout(() => {
          if (this.pending?.id === id)
            this.failChild(runtime, new Error('Speech synthesis timed out.'));
        }, this.synthesisTimeoutMs);
        this.pending = { id, generation: runtime.generation, timer, resolve, reject };
        const line = JSON.stringify({ id, text, voice }) + '\n';
        runtime.process.stdin.write(line, 'utf8', (error) => {
          if (error && this.pending?.id === id)
            this.failChild(runtime, new Error('Speech request could not be sent.'));
        });
      });
    } finally {
      if (this.activeRequest === request) this.activeRequest = undefined;
    }
  }

  cancel(): void {
    this.requestEpoch += 1;
    this.activeRequest = undefined;
    const opening = this.opening;
    this.opening = undefined;
    this.rejectPending(new Error('Speech request was cancelled.'));
    opening?.cancel(new Error('Speech request was cancelled.'));
    const child = this.child;
    if (child) this.failChild(child, new Error('Speech request was cancelled.'));
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.requestEpoch += 1;
    this.activeRequest = undefined;
    const opening = this.opening;
    this.opening = undefined;
    opening?.cancel(new Error('Speech runtime is closed.'));
    const child = this.child;
    this.child = undefined;
    this.rejectPending(new Error('Speech runtime is closed.'));
    if (child) {
      clearTimeout(child.startupTimer);
      child.process.kill();
    }
  }

  private async ensureChild(epoch: number): Promise<RuntimeChild> {
    if (this.closed || epoch !== this.requestEpoch)
      throw new Error('Speech request was cancelled.');
    const ready = await this.status();
    if (this.closed || epoch !== this.requestEpoch)
      throw new Error('Speech request was cancelled.');
    if (!ready.available) throw new Error(ready.detail);
    if (this.child?.ready && this.child.process.exitCode === null) return this.child;
    if (this.opening?.epoch === epoch) return this.opening.promise;

    let resolveOpening!: (value: RuntimeChild) => void;
    let rejectOpening!: (error: Error) => void;
    let settled = false;
    const promise = new Promise<RuntimeChild>((resolve, reject) => {
      resolveOpening = resolve;
      rejectOpening = reject;
    });
    const opening: Opening = {
      epoch,
      promise,
      cancel: () => {},
    };
    this.opening = opening;

    try {
      const child = this.spawnProcess(
        this.pythonPath,
        [this.scriptPath, '--serve', '--home', this.home],
        {
          cwd: this.home,
          stdio: ['pipe', 'pipe', 'pipe'],
          env: this.childEnvironment(),
          windowsHide: true,
        },
      );
      let runtime!: RuntimeChild;
      const clearOpening = () => {
        if (this.opening === opening) this.opening = undefined;
      };
      const settleError = (error: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(runtime.startupTimer);
        clearOpening();
        if (this.child === runtime) this.child = undefined;
        rejectOpening(error);
      };
      runtime = {
        process: child,
        startupTimer: setTimeout(() => {
          settleError(new Error('Speech engine did not start in time.'));
          child.kill();
        }, this.startupTimeoutMs),
        generation: ++this.generation,
        ready: false,
        lineChunks: [],
        lineBytes: 0,
        onReady: (error) => {
          if (settled) return;
          if (error) {
            settleError(error);
            child.kill();
          } else {
            settled = true;
            clearTimeout(runtime.startupTimer);
            clearOpening();
            runtime.ready = true;
            resolveOpening(runtime);
          }
        },
      };
      opening.cancel = (error) => {
        settleError(error);
        child.kill();
      };
      this.child = runtime;
      child.stdout.on('data', (chunk: Buffer) => this.consumeStdout(runtime, chunk));
      child.once('error', () => {
        settleError(new Error('Speech engine could not start.'));
        this.rejectForGeneration(runtime.generation, new Error('Speech engine stopped.'));
      });
      child.once('exit', () => {
        clearTimeout(runtime.startupTimer);
        clearOpening();
        if (this.child === runtime) this.child = undefined;
        if (!settled) {
          settled = true;
          rejectOpening(new Error('Speech engine stopped while starting.'));
        }
        this.rejectForGeneration(runtime.generation, new Error('Speech engine stopped.'));
      });
      child.stderr.on('data', () => {
        // Engine diagnostics stay private; never forward text or local paths to the UI.
      });
    } catch {
      settled = true;
      if (this.opening === opening) this.opening = undefined;
      rejectOpening(new Error('Speech engine could not start.'));
    }
    return promise.finally(() => {
      if (this.opening === opening) this.opening = undefined;
    });
  }

  private consumeStdout(runtime: RuntimeChild, chunk: Buffer): void {
    let start = 0;
    while (start < chunk.length) {
      const newline = chunk.indexOf(0x0a, start);
      const end = newline < 0 ? chunk.length : newline;
      const part = chunk.subarray(start, end);
      if (part.length > 0) {
        runtime.lineChunks.push(part);
        runtime.lineBytes += part.length;
      }
      if (runtime.lineBytes > MAX_PROTOCOL_LINE) {
        this.failChild(runtime, new Error('Speech engine returned oversized audio.'));
        runtime.onReady(new Error('Speech engine returned an invalid response.'));
        return;
      }
      if (newline < 0) return;
      const line = Buffer.concat(runtime.lineChunks, runtime.lineBytes)
        .toString('utf8')
        .replace(/\r$/, '');
      runtime.lineChunks = [];
      runtime.lineBytes = 0;
      this.onLine(runtime, line);
      if (this.child !== runtime) return;
      start = newline + 1;
    }
  }

  private onLine(runtime: RuntimeChild, line: string): void {
    let message: { type?: string; id?: string; ok?: boolean; audio?: string } | null;
    try {
      message = JSON.parse(line) as typeof message;
    } catch {
      this.failChild(runtime, new Error('Speech engine returned an invalid response.'));
      runtime.onReady(new Error('Speech engine returned an invalid response.'));
      return;
    }
    if (!runtime.ready) {
      if (
        message &&
        typeof message === 'object' &&
        !Array.isArray(message) &&
        message.type === 'ready'
      )
        runtime.onReady();
      else runtime.onReady(new Error('Speech engine could not load the local model.'));
      return;
    }
    if (!message || typeof message !== 'object' || Array.isArray(message)) {
      this.failChild(runtime, new Error('Speech engine returned an invalid response.'));
      return;
    }
    const pending = this.pending;
    if (!pending || pending.generation !== runtime.generation || message.id !== pending.id) return;
    clearTimeout(pending.timer);
    this.pending = undefined;
    if (message.ok !== true || typeof message.audio !== 'string') {
      pending.reject(new Error('Speech synthesis failed.'));
      return;
    }
    const bytes = Buffer.byteLength(message.audio, 'base64');
    if (bytes === 0 || bytes > MAX_AUDIO_BYTES) {
      pending.reject(new Error('Speech engine returned oversized audio.'));
      this.failChild(runtime, new Error('Speech engine returned oversized audio.'));
      return;
    }
    pending.resolve(message.audio);
  }

  private failChild(runtime: RuntimeChild, error: Error): void {
    if (this.child !== runtime) return;
    this.child = undefined;
    clearTimeout(runtime.startupTimer);
    this.rejectForGeneration(runtime.generation, error);
    runtime.process.kill();
  }

  private rejectPending(error: Error): void {
    const pending = this.pending;
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pending = undefined;
    pending.reject(error);
  }

  private rejectForGeneration(generation: number, error: Error): void {
    if (this.pending?.generation === generation) this.rejectPending(error);
  }

  private childEnvironment(): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = {
      PATH: process.env.PATH ?? '',
      HOME: this.home,
      USERPROFILE: this.home,
      HF_HOME: join(this.home, 'hf-cache'),
      HF_HUB_OFFLINE: '1',
      HF_HUB_DISABLE_TELEMETRY: '1',
      PYTHONNOUSERSITE: '1',
      PYTHONDONTWRITEBYTECODE: '1',
    };
    if (process.platform === 'win32') {
      env.SystemRoot = process.env.SystemRoot;
      env.TEMP = process.env.TEMP;
      env.TMP = process.env.TMP;
      env.PATHEXT = process.env.PATHEXT;
    } else {
      env.TMPDIR = process.env.TMPDIR;
      env.LD_LIBRARY_PATH = process.env.LD_LIBRARY_PATH;
      env.DYLD_LIBRARY_PATH = process.env.DYLD_LIBRARY_PATH;
    }
    env.PATH = (env.PATH ?? '').split(delimiter).filter(Boolean).join(delimiter);
    return env;
  }
}

export type SpeechVoice = Voice;
