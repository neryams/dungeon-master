import { mkdtemp, rm, mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { initialize } from '../dist/store.js';
import { CampaignService } from '../dist/service.js';
import { JournalAdapter } from '../dist/journal.js';
export class FileJournal {
  calls = [];
  fail = false;
  failAfterWrite = false;
  constructor(root) {
    this.root = root;
  }
  async call(name, args) {
    this.calls.push({ name, args });
    if (this.fail) throw Error('offline');
    if (name === 'write_entry') {
      const path = join(this.root, 'journal', `${args.title.split(' ')[0]}.md`);
      await writeFile(path, args.content, { flag: 'wx' });
      if (this.failAfterWrite) throw Error('lost acknowledgement');
      return { created: `journal/${args.title.split(' ')[0]}.md` };
    }
    if (name === 'get_entry') return readFile(join(this.root, args.path), 'utf8');
    if (name === 'search_journal')
      return {
        hits: await Promise.all(
          (await readdir(join(this.root, 'journal')))
            .filter((f) => f.endsWith('.md'))
            .map(async (f) => ({
              file: `journal/${f}`,
              heading: 'Scene',
              snippet: await readFile(join(this.root, 'journal', f), 'utf8'),
              score: 1,
            })),
        ),
      };
    throw Error('unsupported');
  }
  async close() {}
}
export async function fixture(t) {
  const parent = await mkdtemp(join(tmpdir(), 'dm-test-'));
  t.after(() => rm(parent, { recursive: true, force: true }));
  const store = await initialize(join(parent, 'campaign'), {
    schemaVersion: 1,
    id: 'test',
    name: 'Test',
    edition: '2024',
    premise: '',
    tone: 'Adventure',
    houseRules: [],
  });
  const backend = new FileJournal(store.root),
    journal = new JournalAdapter(store, backend),
    service = new CampaignService(store, journal);
  return { parent, store, backend, journal, service };
}
export const hero = {
  id: 'hero',
  kind: 'character',
  name: 'Hero',
  character: { hp: 10, maxHp: 20, tempHp: 4, resources: { slots: { current: 2, max: 2 } } },
};
export async function apply(service, changes, extra = {}) {
  const { revision } = await service.execute('campaign_status', {});
  return service.execute('apply_campaign_changes', {
    operationId: randomUUID(),
    expectedRevision: revision,
    reason: 'Test action',
    changes,
    ...extra,
  });
}
export async function record(service, content = 'The duke promised a boat.', visibility = 'party') {
  const { revision } = await service.execute('campaign_status', {});
  return service.execute('record_scene', {
    operationId: randomUUID(),
    expectedRevision: revision,
    reason: 'Scene completed',
    title: 'The audience',
    content,
    visibility,
  });
}
