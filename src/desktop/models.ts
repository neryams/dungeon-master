import { spawn, execFile } from 'node:child_process';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { promisify } from 'node:util';
import type { ModelCatalog } from './contracts.js';

const execute = promisify(execFile);
const MAX_STDOUT = 2 * 1024 * 1024;
const MAX_MODEL_PAGES = 20;
const MAX_MODELS = 1000;
const MAX_DISPLAY_NAME_LENGTH = 200;
const MAX_DESCRIPTION_LENGTH = 1000;
const MAX_CURSOR_LENGTH = 4096;
const TERMINATION_GRACE_MS = 250;
const MODEL_ID = /^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,199}$/;
const SAFE_TEXT = /^[^\u0000-\u001f\u007f]*$/;

export interface ModelDiscoveryOptions {
  env?: NodeJS.ProcessEnv;
  cwd?: string;
  prefixArgs?: string[];
  timeoutMs?: number;
}

function catalog(entries: ModelCatalog['models']): ModelCatalog {
  if (!entries.length) throw new Error('The provider returned no available models.');
  const preferred = entries.find((model) => model.isDefault);
  return { models: entries, ...(preferred ? { defaultModel: preferred.id } : {}) };
}

function parseAntigravity(output: string): ModelCatalog {
  const models: ModelCatalog['models'] = [];
  const seen = new Set<string>();
  for (const raw of output.split(/\r?\n/)) {
    if (!raw.trim()) continue;
    const [id, name, ...rest] = raw.split('\t');
    if (
      !id ||
      !name ||
      rest.length ||
      name.length > MAX_DISPLAY_NAME_LENGTH ||
      !SAFE_TEXT.test(name) ||
      !name.trim()
    )
      throw new Error('Antigravity returned a malformed model catalog.');
    if (!MODEL_ID.test(id)) continue;
    if (seen.has(id)) continue;
    if (models.length >= MAX_MODELS)
      throw new Error('Antigravity returned too many available models.');
    seen.add(id);
    models.push({ id, name: name.trim() });
  }
  return catalog(models);
}

async function discoverAntigravity(executable: string, options: ModelDiscoveryOptions) {
  let stdout: string;
  try {
    const result = await execute(executable, [...(options.prefixArgs ?? []), 'models'], {
      cwd: options.cwd,
      env: options.env ?? process.env,
      timeout: options.timeoutMs ?? 15000,
      maxBuffer: MAX_STDOUT,
      killSignal: process.platform === 'win32' ? 'SIGTERM' : 'SIGKILL',
      windowsHide: true,
    });
    stdout = result.stdout;
  } catch {
    throw new Error('Could not read available models from Antigravity. Check the CLI and sign-in.');
  }
  return parseAntigravity(stdout);
}

function signalOwned(child: ChildProcessWithoutNullStreams, signal: NodeJS.Signals) {
  if (!child.pid) return;
  try {
    if (process.platform === 'win32') child.kill(signal);
    else process.kill(-child.pid, signal);
  } catch {
    try {
      child.kill(signal);
    } catch {}
  }
}

function terminateOwned(
  child: ChildProcessWithoutNullStreams,
  closed: Promise<void>,
): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) {
    signalOwned(child, 'SIGKILL');
    return closed;
  }
  signalOwned(child, 'SIGTERM');
  const escalation = setTimeout(() => signalOwned(child, 'SIGKILL'), TERMINATION_GRACE_MS);
  return closed.finally(() => clearTimeout(escalation)).then(() => signalOwned(child, 'SIGKILL'));
}

async function discoverCodex(executable: string, options: ModelDiscoveryOptions) {
  const timeoutMs = options.timeoutMs ?? 15000;
  const child = spawn(
    executable,
    [...(options.prefixArgs ?? []), 'app-server', '--listen', 'stdio://'],
    {
      cwd: options.cwd,
      env: options.env ?? process.env,
      stdio: ['pipe', 'pipe', 'pipe'],
      detached: process.platform !== 'win32',
      windowsHide: true,
    },
  );
  child.stderr.on('data', () => {});
  child.stdout.setEncoding('utf8');
  let closeResolve!: () => void;
  const childClosed = new Promise<void>((resolve) => {
    closeResolve = resolve;
  });
  child.once('close', closeResolve);
  let buffer = '';
  let stdoutSize = 0;
  let sequence = 0;
  const pending = new Map<number, { resolve(value: any): void; reject(error: Error): void }>();
  let ended = false;
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    finish(new Error('Codex model discovery timed out.'));
  }, timeoutMs);
  let finishPromiseResolve!: () => void;
  let finishPromiseReject!: (error: Error) => void;
  const finished = new Promise<void>((resolve, reject) => {
    finishPromiseResolve = resolve;
    finishPromiseReject = reject;
  });
  // The promise is observed by the discovery catch path, including when shutdown fails.
  void finished.catch(() => {});
  function finish(error?: Error) {
    if (ended) return;
    ended = true;
    clearTimeout(timer);
    for (const request of pending.values())
      request.reject(error ?? new Error('Codex app-server closed.'));
    pending.clear();
    void terminateOwned(child, childClosed).then(
      () => (error ? finishPromiseReject(error) : finishPromiseResolve()),
      () => finishPromiseReject(error ?? new Error('Could not stop Codex model discovery.')),
    );
  }
  child.on('error', () => finish(new Error('Could not start Codex model discovery.')));
  child.on('close', () => {
    if (!ended) finish(new Error('Codex model discovery disconnected.'));
  });
  child.stdin.on('error', () => finish(new Error('Could not query the Codex model catalog.')));
  child.stdout.on('data', (chunk: string) => {
    stdoutSize += Buffer.byteLength(chunk);
    if (stdoutSize > MAX_STDOUT)
      return finish(new Error('Codex returned an oversized model catalog.'));
    buffer += chunk;
    let index: number;
    while ((index = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, index).trim();
      buffer = buffer.slice(index + 1);
      if (!line) continue;
      let message: any;
      try {
        message = JSON.parse(line);
      } catch {
        return finish(new Error('Codex returned an invalid model catalog response.'));
      }
      if (Number.isSafeInteger(message?.id) && !message.method) {
        const request = pending.get(message.id);
        if (!request) continue;
        pending.delete(message.id);
        if (message.error) request.reject(new Error('Codex rejected model discovery.'));
        else request.resolve(message.result);
      }
    }
  });
  function send(message: unknown) {
    if (ended) throw new Error('Codex model discovery stopped.');
    child.stdin.write(JSON.stringify(message) + '\n');
  }
  function request(method: string, params: unknown) {
    return new Promise<any>((resolve, reject) => {
      const id = ++sequence;
      pending.set(id, { resolve, reject });
      try {
        send({ id, method, params });
      } catch {
        pending.delete(id);
        reject(new Error('Could not query the Codex model catalog.'));
      }
    });
  }
  try {
    await request('initialize', {
      clientInfo: {
        name: 'dungeon_master_model_discovery',
        title: 'Dungeon Master',
        version: '0.6.0',
      },
    });
    send({ method: 'initialized' });
    const models: ModelCatalog['models'] = [];
    const seen = new Set<string>();
    const seenModels = new Map<string, ModelCatalog['models'][number]>();
    const cursors = new Set<string>();
    let cursor: string | undefined;
    let complete = false;
    for (let pageNumber = 0; pageNumber < MAX_MODEL_PAGES; pageNumber++) {
      const page = await request('model/list', {
        limit: 100,
        includeHidden: false,
        ...(cursor ? { cursor } : {}),
      });
      if (
        !Array.isArray(page?.data) ||
        page.data.length > 100 ||
        (page.nextCursor !== undefined &&
          page.nextCursor !== null &&
          typeof page.nextCursor !== 'string') ||
        (typeof page.nextCursor === 'string' && page.nextCursor.length > MAX_CURSOR_LENGTH)
      )
        throw new Error('Codex returned a malformed model catalog.');
      for (const item of page.data) {
        if (
          !item ||
          typeof item !== 'object' ||
          typeof item.model !== 'string' ||
          typeof item.displayName !== 'string' ||
          item.displayName.length > MAX_DISPLAY_NAME_LENGTH ||
          !SAFE_TEXT.test(item.displayName) ||
          !item.displayName.trim() ||
          (item.description !== undefined &&
            item.description !== null &&
            (typeof item.description !== 'string' ||
              item.description.length > MAX_DESCRIPTION_LENGTH ||
              !SAFE_TEXT.test(item.description))) ||
          (item.isDefault !== undefined && typeof item.isDefault !== 'boolean') ||
          (item.hidden !== undefined && typeof item.hidden !== 'boolean')
        )
          throw new Error('Codex returned a malformed model catalog.');
        if (!MODEL_ID.test(item.model)) continue;
        if (item.hidden) continue;
        if (seen.has(item.model)) {
          if (item.isDefault) {
            const existing = seenModels.get(item.model);
            if (existing) existing.isDefault = true;
          }
          continue;
        }
        seen.add(item.model);
        if (models.length >= MAX_MODELS)
          throw new Error('Codex returned too many available models.');
        const model = {
          id: item.model,
          name: item.displayName.trim(),
          ...(typeof item.description === 'string' && item.description
            ? { description: item.description }
            : {}),
          ...(item.isDefault === true ? { isDefault: true } : {}),
        };
        seenModels.set(item.model, model);
        models.push(model);
      }
      const nextCursor = page.nextCursor;
      if (nextCursor === null || nextCursor === undefined || nextCursor === '') {
        complete = true;
        break;
      }
      if (cursors.has(nextCursor))
        throw new Error('Codex returned a repeated model catalog cursor.');
      cursors.add(nextCursor);
      cursor = nextCursor;
    }
    if (!complete) throw new Error('Codex returned too many model catalog pages.');
    const result = catalog(models);
    finish();
    await finished;
    return result;
  } catch (error) {
    finish(
      error instanceof Error && !/PRIVATE|token|credential|secret/i.test(error.message)
        ? error
        : new Error('Could not read available models from Codex. Check the CLI and sign-in.'),
    );
    await finished.catch(() => {});
    if (timedOut) throw new Error('Codex model discovery timed out.');
    if (
      error instanceof Error &&
      /malformed|no available models|repeated model catalog cursor|too many model catalog pages|too many available models/.test(
        error.message,
      )
    )
      throw error;
    throw new Error('Could not read available models from Codex. Check the CLI and sign-in.');
  }
}

export function providerModels(
  executable: string,
  provider: 'antigravity' | 'codex',
  options: ModelDiscoveryOptions = {},
): Promise<ModelCatalog> {
  return provider === 'antigravity'
    ? discoverAntigravity(executable, options)
    : discoverCodex(executable, options);
}
