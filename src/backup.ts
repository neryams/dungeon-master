import { readdir, readFile, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { CampaignConfig, Event } from './schema.js';
import { CampaignStore, initialize, safePath, atomicWrite } from './store.js';
import { replay, CampaignError } from './domain.js';
export const Archive = z
  .object({
    format: z.literal('dungeon-master-v1'),
    campaign: CampaignConfig,
    events: z.array(Event),
    assets: z.array(z.object({ path: z.string(), base64: z.string() }).strict()),
  })
  .strict();
export async function exportCampaign(store: CampaignStore): Promise<z.infer<typeof Archive>> {
  return store.locked(async () => {
    const { events } = await store.read();
    const assets: { path: string; base64: string }[] = [];
    const walk = async (rel: string) => {
      for (const entry of await readdir(await safePath(store.root, rel), { withFileTypes: true })) {
        const path = `${rel}/${entry.name}`;
        await safePath(store.root, path);
        if (entry.isDirectory()) await walk(path);
        else if (entry.isFile() && entry.name !== '.gitkeep')
          assets.push({
            path,
            base64: (await readFile(join(store.root, path))).toString('base64'),
          });
      }
    };
    await walk('assets');
    return { format: 'dungeon-master-v1', campaign: store.config, events, assets };
  });
}
export async function importCampaign(root: string, raw: unknown): Promise<CampaignStore> {
  const archive = Archive.parse(raw);
  replay(archive.events);
  const operations = new Set<string>(),
    ids = new Set<string>(),
    records = new Set<string>(),
    paths = new Set<string>();
  archive.events.forEach((e, i) => {
    if (
      e.sequence !== i + 1 ||
      operations.has(e.operationId) ||
      ids.has(e.id) ||
      (e.payload.corrects && !ids.has(e.payload.corrects))
    )
      throw new CampaignError('INVALID_ARCHIVE', 'Invalid event history');
    for (const record of e.payload.records) {
      if (records.has(record.id)) throw new CampaignError('INVALID_ARCHIVE', 'Duplicate record');
      records.add(record.id);
    }
    operations.add(e.operationId);
    ids.add(e.id);
  });
  for (const a of archive.assets) {
    if (
      !a.path.startsWith('assets/') ||
      a.path.includes('..') ||
      a.path.includes('\\') ||
      paths.has(a.path) ||
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(a.base64)
    )
      throw new CampaignError('INVALID_ARCHIVE', 'Invalid asset');
    paths.add(a.path);
  }
  const store = await initialize(root, archive.campaign);
  for (const event of archive.events)
    await atomicWrite(
      await safePath(
        store.root,
        `events/${String(event.sequence).padStart(10, '0')}-${event.id}.json`,
        false,
      ),
      JSON.stringify(event, null, 2) + '\n',
    );
  for (const a of archive.assets) {
    const path = await safePath(store.root, a.path, false);
    await mkdir(join(path, '..'), { recursive: true });
    await writeFile(path, Buffer.from(a.base64, 'base64'));
  }
  return store;
}
