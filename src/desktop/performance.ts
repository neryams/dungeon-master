import { appendFile, chmod, mkdir, rename, stat } from 'node:fs/promises';
import { safePath } from '../store.js';
import { inputs } from '../service.js';
import lockfile from 'proper-lockfile';

export type PerformanceKind =
  | 'request-start'
  | 'provider-dispatch'
  | 'provider-first-event'
  | 'provider-tool-start'
  | 'provider-tool-end'
  | 'backend-tool'
  | 'first-publication'
  | 'request-complete'
  | 'request-interrupted';

export interface PerformanceRecord {
  kind: PerformanceKind;
  requestId?: string;
  provider?: 'antigravity' | 'codex' | 'ollama';
  model?: string;
  tool?: string;
  status?: 'ok' | 'error' | 'interrupted';
  elapsedMs?: number;
  callId?: string;
  at?: string;
}

const MAX_BYTES = 1024 * 1024;
const ALLOWED_TOOLS = new Set([...Object.keys(inputs), 'import_generated_map_art']);
let writeQueue: Promise<void> = Promise.resolve();
let queuedWrites = 0;

/** Appends only allowlisted timing metadata outside the campaign event history. */
export async function appendPerformanceRecord(
  campaignRoot: string,
  record: PerformanceRecord,
  fileName: 'performance.jsonl' | 'performance-backend.jsonl' = 'performance.jsonl',
): Promise<void> {
  if (queuedWrites >= 512) return;
  queuedWrites++;
  const queuedRecord = { ...record, at: record.at ?? new Date().toISOString() };
  const next = writeQueue.then(() => appendRecord(campaignRoot, queuedRecord, fileName));
  writeQueue = next.catch(() => {});
  return next.finally(() => {
    queuedWrites = Math.max(0, queuedWrites - 1);
  });
}

async function appendRecord(campaignRoot: string, record: PerformanceRecord, fileName: string) {
  try {
    const safe: PerformanceRecord = {
      kind: record.kind,
      at: record.at ?? new Date().toISOString(),
    };
    if (typeof record.requestId === 'string') safe.requestId = record.requestId.slice(0, 100);
    if (record.provider) safe.provider = record.provider;
    if (typeof record.model === 'string') safe.model = record.model.slice(0, 100);
    if (
      record.tool &&
      (ALLOWED_TOOLS.has(record.tool) ||
        /^(call_mcp_tool|read_file|send_message|image_gen|unknown)$/.test(record.tool))
    )
      safe.tool = record.tool;
    if (typeof record.callId === 'string') safe.callId = record.callId.slice(0, 100);
    if (record.status) safe.status = record.status;
    if (Number.isFinite(record.elapsedMs))
      safe.elapsedMs = Math.max(0, Math.round(record.elapsedMs!));
    const dir = await safePath(campaignRoot, '.dm/hotseat', false);
    await mkdir(dir, { recursive: true, mode: 0o700 });
    const path = await safePath(campaignRoot, `.dm/hotseat/${fileName}`, false);
    const backup = await safePath(campaignRoot, `.dm/hotseat/${fileName}.1`, false);
    const lockPath = await safePath(campaignRoot, `.dm/hotseat/.${fileName}.lockdir`, false);
    await mkdir(lockPath, { recursive: true, mode: 0o700 });
    const release = await lockfile.lock(lockPath, {
      retries: 0,
      stale: 30000,
      update: 10000,
      onCompromised: () => {},
    });
    const bytes = Buffer.from(JSON.stringify(safe) + '\n');
    try {
      const current = await stat(path).catch(() => undefined);
      if (current && current.size + bytes.length > MAX_BYTES) {
        await rename(path, backup);
        await chmod(backup, 0o600).catch(() => {});
      }
      await appendFile(path, bytes, { mode: 0o600 });
      await chmod(path, 0o600);
    } finally {
      await release();
    }
  } catch {
    // Diagnostics must never delay or interrupt a game action.
  }
}
