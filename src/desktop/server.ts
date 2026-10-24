// Desktop-only lifecycle wrapper. The ordinary ChatGPT/Codex MCP entry is unchanged.
import { readFile, mkdir } from 'node:fs/promises';
import { z } from 'zod';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CampaignStore, safePath, atomicWrite } from '../store.js';
import { LocalMemoryGuard } from './memory.js';
import { importGeneratedArt } from './art.js';
import { CampaignService, ToolName } from '../service.js';
import { JournalAdapter, McpJournal } from '../journal.js';
import { createMcpServer } from '../server.js';
import { DesktopActivity } from './activity.js';
import { notifyActivity } from './activity-bus.js';
import { appendPerformanceRecord } from './performance.js';

const root = process.argv[process.argv.indexOf('--campaign') + 1];
const token = process.env.DM_HOTSEAT_OWNER_TOKEN;
if (!root || !token) throw new Error('Desktop campaign owner required');
const store = await CampaignStore.open(root);
async function checkOwner(): Promise<{ endpoint?: string; activeRequestId?: string }> {
  const owner = JSON.parse(
    await readFile(await safePath(store.root, '.dm/hotseat/owner.json'), 'utf8'),
  );
  if (owner.token !== token || !Number.isSafeInteger(owner.pid) || owner.pid <= 0)
    throw new Error('Desktop session ended');
  process.kill(owner.pid, 0);
  return owner;
}
async function announce(
  kind: 'activity' | 'changed',
  activity?: import('./activity.js').ActivitySnapshot,
  requestId?: string,
  operationId?: string,
) {
  try {
    const owner = await checkOwner();
    await notifyActivity(owner.endpoint, {
      token: token!,
      kind,
      ...(activity ? { activity } : {}),
      ...(requestId ? { requestId } : {}),
      ...(operationId ? { operationId } : {}),
    });
  } catch {
    /* Feedback is disposable; tool results remain authoritative. */
  }
}
const activity = new DesktopActivity(store, token, (snapshot, requestId) =>
  announce('activity', snapshot, requestId),
);
await checkOwner();
class OwnedService extends CampaignService {
  private published: string[] = [];
  private memory =
    process.env.DM_DESKTOP_PROVIDER === 'ollama' ? new LocalMemoryGuard(store) : undefined;
  override async execute(name: ToolName, raw: unknown) {
    const started = Date.now();
    let status: 'ok' | 'error' = 'error';
    let owner: { endpoint?: string; activeRequestId?: string } = {};
    const op =
      raw &&
      typeof raw === 'object' &&
      typeof (raw as { operationId?: unknown }).operationId === 'string'
        ? (raw as { operationId: string }).operationId.slice(0, 100)
        : undefined;
    let result: unknown;
    try {
      owner = await checkOwner();
      await this.memory?.before(name, raw);
      await activity.beginTool(name, raw).catch(() => {});
      try {
        result = await super.execute(name, raw);
        this.memory?.after(name, raw, result);
      } catch (error) {
        await activity.finishTool(op, error).catch(() => {});
        await announce('changed', undefined, undefined, op);
        throw error;
      }
      status = 'ok';
      if (
        name === 'publish_table_message' &&
        (raw as { delivery?: string }).delivery !== 'progress' &&
        owner.activeRequestId &&
        !this.published.includes(owner.activeRequestId)
      ) {
        this.published.push(owner.activeRequestId);
        if (this.published.length > 32) this.published.shift();
        void appendPerformanceRecord(
          store.root,
          { kind: 'first-publication', requestId: owner.activeRequestId },
          'performance-backend.jsonl',
        );
      }
      if (
        name === 'publish_table_message' &&
        (raw as { delivery?: string }).delivery === 'progress'
      )
        void appendPerformanceRecord(
          store.root,
          { kind: 'progress-publication', requestId: owner.activeRequestId },
          'performance-backend.jsonl',
        );
      await activity.finishTool(op).catch(() => {});
      await announce('changed', undefined, undefined, op);
      if (name === 'render_location_map' && (raw as { mode?: string }).mode === 'reference') {
        const rendered = result as { image?: { data: string }; path?: string };
        if (rendered.image && rendered.path) {
          const dir = await safePath(store.root, '.dm/hotseat/workspace/map-references', false);
          await mkdir(dir, { recursive: true });
          const path = await safePath(
            store.root,
            `.dm/hotseat/workspace/map-references/${rendered.path.split('/').at(-1)}`,
            false,
          );
          await atomicWrite(path, Buffer.from(rendered.image.data, 'base64'));
          return { ...rendered, referencePath: path };
        }
      }
      return result;
    } catch (error) {
      status = 'error';
      throw error;
    } finally {
      void appendPerformanceRecord(
        store.root,
        {
          kind: 'backend-tool',
          tool: name,
          requestId: owner.activeRequestId,
          callId: op,
          elapsedMs: Date.now() - started,
          status,
        },
        'performance-backend.jsonl',
      );
    }
  }
}
const service = new OwnedService(store, new JournalAdapter(store, new McpJournal(store.root)));
const server = createMcpServer(service, {
  imageContentOnly: process.env.DM_DESKTOP_PROVIDER === 'ollama',
});
if (process.env.DM_DESKTOP_PROVIDER !== 'ollama')
  server.registerTool(
    'import_generated_map_art',
    {
      description:
        'Copy a native host-generated PNG/JPEG/WebP from this connected conversation into campaign assets. File handling only; then register_map_art with the returned path, source revision and reference extent. No shell or API calls.',
      inputSchema: { sourcePath: z.string().min(1).max(4096) },
      annotations: { destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ sourcePath }) => {
      const started = Date.now();
      let owner: { endpoint?: string; activeRequestId?: string } = {};
      let status: 'ok' | 'error' = 'error';
      try {
        owner = await checkOwner();
        const result = await importGeneratedArt(
          store,
          sourcePath,
          undefined,
          process.env.DM_DESKTOP_PROVIDER === 'codex' ? { ownerToken: token! } : undefined,
        );
        status = 'ok';
        return { content: [{ type: 'text', text: JSON.stringify(result) }] };
      } catch {
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: 'Could not import image. Use a valid generated raster image from this connected provider conversation; do not use shell or invent paths.',
            },
          ],
        };
      } finally {
        void appendPerformanceRecord(
          store.root,
          {
            kind: 'backend-tool',
            tool: 'import_generated_map_art',
            requestId: owner.activeRequestId,
            elapsedMs: Date.now() - started,
            status,
          },
          'performance-backend.jsonl',
        );
      }
    },
  );
let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  clearInterval(heartbeat);
  const timeout = setTimeout(() => process.exit(0), 2000);
  timeout.unref();
  try {
    await server.close();
    await service.close();
  } finally {
    process.exit(0);
  }
}
const heartbeat = setInterval(() => {
  void checkOwner().catch(close);
}, 1000);
process.stdin.once('end', () => {
  void close();
});
process.once('SIGTERM', () => {
  void close();
});
process.once('SIGINT', () => {
  void close();
});
await server.connect(new StdioServerTransport());
