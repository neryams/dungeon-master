import {
  mkdir,
  readdir,
  readFile,
  realpath,
  lstat,
  open,
  rename,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { join, resolve, relative, sep } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import lockfile from 'proper-lockfile';
import { CampaignConfig, Event, Mutation, Payload, State } from './schema.js';
import { applyPayload, CampaignError, replay } from './domain.js';

export function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.entries(value)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${stableJson(v)}`)
      .join(',')}}`;
  return JSON.stringify(value);
}
export async function atomicWrite(path: string, value: string): Promise<void> {
  const tmp = `${path}.${randomUUID()}.tmp`;
  try {
    const file = await open(tmp, 'wx', 0o600);
    try {
      await file.writeFile(value);
      await file.sync();
    } finally {
      await file.close();
    }
    await rename(tmp, path);
    const dir = await open(resolve(path, '..'), 'r');
    try {
      await dir.sync();
    } finally {
      await dir.close();
    }
  } finally {
    await unlink(tmp).catch(() => {});
  }
}
export async function safePath(root: string, rel: string, mustExist = true): Promise<string> {
  if (
    !rel ||
    rel.includes('\\') ||
    rel.split('/').includes('..') ||
    rel.startsWith('/') ||
    /^[a-z]+:/i.test(rel)
  )
    throw new CampaignError('INVALID_PATH', 'Expected a campaign-relative path');
  const path = resolve(root, rel);
  if (relative(root, path).startsWith('..') || path === root)
    throw new CampaignError('INVALID_PATH', 'Path escapes campaign');
  let part = root;
  for (const segment of relative(root, path).split(sep)) {
    part = join(part, segment);
    try {
      if ((await lstat(part)).isSymbolicLink())
        throw new CampaignError('INVALID_PATH', 'Symlinks are not permitted in campaign data');
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT' && !mustExist) break;
      throw e;
    }
  }
  return path;
}
export class CampaignStore {
  private constructor(
    public readonly root: string,
    public readonly config: CampaignConfig,
  ) {}
  static async open(root: string): Promise<CampaignStore> {
    root = await realpath(root);
    const config = CampaignConfig.parse(
      JSON.parse(await readFile(await safePath(root, 'campaign.json'), 'utf8')),
    );
    for (const folder of ['events', 'journal', 'assets']) await safePath(root, folder);
    await safePath(root, '.dm', false);
    await mkdir(join(root, '.dm'), { recursive: true });
    const journalConfig = JSON.parse(
      await readFile(await safePath(root, 'journal-rag.config.json'), 'utf8'),
    );
    if (
      JSON.stringify(journalConfig.sources) !== JSON.stringify(['journal']) ||
      journalConfig.cachePath !== '.journal-rag/index.json'
    )
      throw new CampaignError(
        'INVALID_CONFIG',
        'Journal sources and cache must remain bound to this campaign',
      );
    await safePath(root, '.journal-rag', false);
    return new CampaignStore(root, config);
  }
  async locked<T>(fn: () => Promise<T>): Promise<T> {
    const release = await lockfile.lock(this.root, {
      realpath: true,
      stale: 30000,
      update: 10000,
      retries: { retries: 30, minTimeout: 30, maxTimeout: 200 },
    });
    try {
      return await fn();
    } finally {
      await release();
    }
  }
  async events(): Promise<Event[]> {
    await safePath(this.root, 'events');
    const names = (await readdir(join(this.root, 'events')))
      .filter((n) => n.endsWith('.json'))
      .sort();
    const events: Event[] = [];
    const operations = new Set<string>();
    const ids = new Set<string>();
    for (const name of names) {
      const e = Event.parse(
        JSON.parse(await readFile(await safePath(this.root, `events/${name}`), 'utf8')),
      );
      if (
        e.sequence !== events.length + 1 ||
        name !== `${String(e.sequence).padStart(10, '0')}-${e.id}.json` ||
        operations.has(e.operationId) ||
        ids.has(e.id)
      )
        throw new CampaignError(
          'CORRUPT_HISTORY',
          `Invalid sequence, filename or duplicate event: ${name}`,
        );
      if (e.payload.corrects && !ids.has(e.payload.corrects))
        throw new CampaignError('CORRUPT_HISTORY', 'Correction target is missing');
      events.push(e);
      operations.add(e.operationId);
      ids.add(e.id);
    }
    const records = new Set<string>();
    for (const event of events)
      for (const record of event.payload.records) {
        if (records.has(record.id))
          throw new CampaignError('CORRUPT_HISTORY', 'Duplicate journal record ID');
        records.add(record.id);
      }
    return events;
  }
  async read(): Promise<{ events: Event[]; state: State }> {
    const events = await this.events();
    return { events, state: replay(events) };
  }
  async transact(
    meta: Mutation,
    request: unknown,
    make: (state: State, events: Event[]) => Payload,
  ): Promise<{ event: Event; state: State; duplicate: boolean; warnings: string[] }> {
    meta = Mutation.parse(meta);
    const hash = createHash('sha256').update(stableJson(request)).digest('hex');
    return this.locked(async () => {
      const { events, state } = await this.read();
      const prior = events.find((e) => e.operationId === meta.operationId);
      if (prior) {
        if (prior.requestHash !== hash)
          throw new CampaignError(
            'OPERATION_REUSED',
            'Operation ID was already used with different input',
          );
        return { event: prior, state, duplicate: true, warnings: [] };
      }
      if (meta.expectedRevision !== state.revision)
        throw new CampaignError('REVISION_CONFLICT', 'Reload current state before changing it', {
          currentRevision: state.revision,
        });
      const payload = Payload.parse(make(structuredClone(state), events));
      const recordIds = new Set(events.flatMap((e) => e.payload.records.map((r) => r.id)));
      for (const r of payload.records) {
        if (recordIds.has(r.id))
          throw new CampaignError('DUPLICATE_RECORD', 'Record ID already exists');
        recordIds.add(r.id);
      }
      if (payload.corrects && !events.some((e) => e.id === payload.corrects))
        throw new CampaignError('NOT_FOUND', 'Correction event not found');
      const next = applyPayload(state, payload);
      next.revision = state.revision + 1;
      const event = Event.parse({
        schemaVersion: 1,
        id: randomUUID(),
        sequence: next.revision,
        operationId: meta.operationId,
        requestHash: hash,
        timestamp: new Date().toISOString(),
        actor: meta.actor,
        reason: meta.reason,
        session: state.session,
        scene: state.scene?.id,
        payload,
      });
      const file = `events/${String(event.sequence).padStart(10, '0')}-${event.id}.json`;
      await atomicWrite(
        await safePath(this.root, file, false),
        JSON.stringify(event, null, 2) + '\n',
      );
      const warnings: string[] = [];
      try {
        await atomicWrite(
          await safePath(this.root, '.dm/state.json', false),
          JSON.stringify(next, null, 2) + '\n',
        );
      } catch {
        warnings.push('Event saved; state cache could not be refreshed. Replay remains available.');
      }
      return { event, state: next, duplicate: false, warnings };
    });
  }
}
export async function initialize(root: string, config: CampaignConfig): Promise<CampaignStore> {
  config = CampaignConfig.parse(config);
  root = resolve(root);
  await mkdir(root, { recursive: false });
  for (const dir of ['events', 'journal', 'assets', '.dm']) await mkdir(join(root, dir));
  await writeFile(join(root, 'campaign.json'), JSON.stringify(config, null, 2) + '\n', {
    flag: 'wx',
  });
  await writeFile(
    join(root, 'journal-rag.config.json'),
    JSON.stringify({ sources: ['journal'], cachePath: '.journal-rag/index.json' }, null, 2) + '\n',
  );
  await writeFile(
    join(root, '.gitignore'),
    '.dm/\n.journal-rag/\n*.lock/\n*.tmp\n.codex/config.toml\n',
  );
  for (const dir of ['events', 'journal', 'assets'])
    await writeFile(join(root, dir, '.gitkeep'), '');
  await writeFile(
    join(root, 'AGENTS.md'),
    '# Campaign workspace\n\nUse the Dungeon Master plugin. Call resume_campaign before play. Use campaign tools for all state and historical writes; do not edit events or call raw journal tools. Read exact character properties from get_campaign_entity. Persist resolved mechanics immediately and narrative details at scene boundaries. Keep DM plans out of player-facing summaries.\n',
  );
  return CampaignStore.open(root);
}
