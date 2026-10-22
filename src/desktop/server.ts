// Desktop-only lifecycle wrapper. The ordinary ChatGPT/Codex MCP entry is unchanged.
import { readFile, mkdir } from 'node:fs/promises';
import { z } from 'zod';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CampaignStore, safePath, atomicWrite } from '../store.js';
import { importGeneratedArt } from './art.js';
import { CampaignService, ToolName } from '../service.js';
import { JournalAdapter, McpJournal } from '../journal.js';
import { createMcpServer } from '../server.js';

const root = process.argv[process.argv.indexOf('--campaign') + 1];
const token = process.env.DM_HOTSEAT_OWNER_TOKEN;
if (!root || !token) throw new Error('Desktop campaign owner required');
const store = await CampaignStore.open(root);
async function checkOwner() {
  const owner = JSON.parse(
    await readFile(await safePath(store.root, '.dm/hotseat/owner.json'), 'utf8'),
  );
  if (owner.token !== token || !Number.isSafeInteger(owner.pid) || owner.pid <= 0)
    throw new Error('Desktop session ended');
  process.kill(owner.pid, 0);
}
await checkOwner();
class OwnedService extends CampaignService {
  override async execute(name: ToolName, raw: unknown) {
    await checkOwner();
    const result = await super.execute(name, raw);
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
  }
}
const service = new OwnedService(store, new JournalAdapter(store, new McpJournal(store.root)));
const server = createMcpServer(service);
server.registerTool(
  'import_generated_map_art',
  {
    description:
      'Copy a native host-generated PNG/JPEG/WebP from this connected conversation into campaign assets. File handling only; then register_map_art with the returned path, source revision and reference extent. No shell or API calls.',
    inputSchema: { sourcePath: z.string().min(1).max(4096) },
    annotations: { destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  async ({ sourcePath }) => {
    try {
      await checkOwner();
      const result = await importGeneratedArt(
        store,
        sourcePath,
        undefined,
        process.env.DM_DESKTOP_PROVIDER === 'codex' ? { ownerToken: token! } : undefined,
      );
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
