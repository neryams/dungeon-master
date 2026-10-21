import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { createRequire } from 'node:module';
import { readFile, readdir } from 'node:fs/promises';
import { CampaignStore, safePath } from './store.js';
import { CampaignError } from './domain.js';
import { JournalRecord } from './schema.js';

export interface JournalBackend {
  call(name: string, args: Record<string, unknown>): Promise<unknown>;
  close(): Promise<void>;
}
export class McpJournal implements JournalBackend {
  private client?: Client;
  private transport?: StdioClientTransport;
  private connecting?: Promise<Client>;
  constructor(
    private root: string,
    private serverPath?: string,
    private env: Record<string, string> = {},
  ) {}
  private async connect(): Promise<Client> {
    if (this.client) return this.client;
    if (this.connecting) return this.connecting;
    this.connecting = (async () => {
      const path =
        this.serverPath ??
        process.env.DM_JOURNAL_SERVER ??
        createRequire(import.meta.url).resolve('journal-rag');
      const transport = new StdioClientTransport({
        command: process.execPath,
        args: [path],
        cwd: this.root,
        env: {
          ...Object.fromEntries(
            Object.entries(process.env).filter((e): e is [string, string] => e[1] !== undefined),
          ),
          ...this.env,
          JOURNAL_RAG_WORKSPACE: this.root,
        },
        stderr: 'pipe',
      });
      // The dependency logs to stderr; never forward campaign data to MCP stdout.
      transport.stderr?.on('data', () => {});
      const client = new Client({ name: 'dungeon-master-journal-adapter', version: '0.1.0' });
      try {
        await client.connect(transport);
        this.client = client;
        this.transport = transport;
        return client;
      } catch (e) {
        await transport.close().catch(() => {});
        throw e;
      }
    })();
    try {
      return await this.connecting;
    } finally {
      this.connecting = undefined;
    }
  }
  async call(name: string, args: Record<string, unknown>): Promise<unknown> {
    const client = await this.connect();
    let result;
    try {
      result = await client.callTool({ name, arguments: args }, undefined, { timeout: 15000 });
    } catch (error) {
      await this.close().catch(() => {});
      throw error;
    }
    if (result.isError) throw new CampaignError('JOURNAL_ERROR', 'Journal tool failed');
    const text = (result.content as { type: string; text?: string }[])
      .filter((c) => c.type === 'text')
      .map((c) => c.text)
      .join('\n');
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }
  async close(): Promise<void> {
    await this.client?.close();
    await this.transport?.close();
    this.client = undefined;
    this.transport = undefined;
  }
}
export function journalContent(record: JournalRecord): string {
  return `# ${record.title}\n\n<!-- dm-record:${record.id} visibility:${record.visibility} -->\n\n${record.content}\n`;
}
export class JournalAdapter {
  constructor(
    public store: CampaignStore,
    private backend: JournalBackend,
  ) {}
  async catalog(): Promise<Map<string, { path: string; content: string }>> {
    const records = new Map<string, { path: string; content: string }>();
    await safePath(this.store.root, 'journal');
    for (const name of (await readdir(`${this.store.root}/journal`)).filter((n) =>
      n.endsWith('.md'),
    )) {
      const path = `journal/${name}`;
      const content = await readFile(await safePath(this.store.root, path), 'utf8');
      const match = /<!-- dm-record:([\w-]+) visibility:(party|dm) -->/.exec(content);
      if (match) {
        if (records.has(match[1]))
          throw new CampaignError('JOURNAL_CONFLICT', 'Multiple files contain the same record ID');
        records.set(match[1], { path, content });
      }
    }
    return records;
  }
  async flush(): Promise<{
    pending: number;
    delivered: number;
    status: 'ready' | 'pending';
    error?: string;
  }> {
    // Same campaign lock covers write reconciliation and new game mutations across processes.
    return this.store.locked(async () => {
      const records = (await this.store.events()).flatMap((e) => e.payload.records);
      let delivered = 0;
      try {
        const catalog = await this.catalog();
        for (const record of records) {
          const expected = journalContent(record),
            existing = catalog.get(record.id);
          if (existing) {
            if (existing.content !== expected)
              throw new CampaignError(
                'JOURNAL_CONFLICT',
                'Journal record differs from committed history',
              );
            delivered++;
            continue;
          }
          // ID goes first so the dependency's 80-character title slug cannot truncate it.
          await this.backend.call('write_entry', {
            title: `${record.id} ${record.title}`,
            content: expected,
          });
          const found = (await this.catalog()).get(record.id);
          if (!found || found.content !== expected)
            throw new CampaignError(
              'JOURNAL_UNCERTAIN',
              'Journal did not confirm the complete record',
            );
          delivered++;
        }
        return { pending: 0, delivered, status: 'ready' };
      } catch (e) {
        return {
          pending: records.length - delivered,
          delivered,
          status: 'pending',
          error:
            e instanceof CampaignError
              ? e.message
              : 'Journal unavailable; committed records remain safe. Retry checkpoint or resume.',
        };
      }
    });
  }
  async search(query: string, k: number, audience: 'dm' | 'party'): Promise<unknown> {
    // Do not forward arbitrary paths or expose raw journal data; only committed known records qualify.
    const events = await this.store.events();
    const records = events.flatMap((e) => e.payload.records);
    const allowed = new Map(
      records.filter((r) => audience === 'dm' || r.visibility === 'party').map((r) => [r.id, r]),
    );
    const catalog = await this.catalog();
    const paths = new Map(
      [...catalog].filter(([id]) => allowed.has(id)).map(([id, r]) => [r.path, id]),
    );
    try {
      const result = (await this.backend.call('search_journal', { query, k: 50 })) as {
        hits?: unknown[];
      };
      if (!Array.isArray(result?.hits)) throw new Error('Invalid search response');
      const hits = result.hits
        .flatMap((h: unknown) => {
          if (!h || typeof h !== 'object') return [];
          const hit = h as Record<string, unknown>;
          const file = String(hit.file ?? '');
          const id = paths.get(file);
          if (!id) return [];
          // Refuse modified derived files rather than propagating uncommitted prose.
          if (catalog.get(id)?.content !== journalContent(allowed.get(id)!)) return [];
          return [
            {
              recordId: id,
              title: allowed.get(id)!.title,
              reference: `record:${id}`,
              heading: hit.heading,
              excerpt: hit.snippet ?? hit.text ?? hit.content,
              score: hit.score,
            },
          ];
        })
        .slice(0, k);
      return {
        status: 'available',
        hits,
        limit: k,
        coverage: 'Ranked journal results; pending records may not yet be indexed.',
      };
    } catch {
      return {
        status: 'unavailable',
        hits: [],
        message: 'History search unavailable. Use read_campaign_record for known saved records.',
      };
    }
  }
  async read(id: string, audience: 'dm' | 'party'): Promise<unknown> {
    const record = (await this.store.events())
      .flatMap((e) => e.payload.records)
      .find((r) => r.id === id && (audience === 'dm' || r.visibility === 'party'));
    if (!record) throw new CampaignError('NOT_FOUND', 'Campaign record not found');
    const existing = (await this.catalog()).get(id);
    if (existing && existing.content === journalContent(record)) {
      await safePath(this.store.root, existing.path);
      try {
        const value = await this.backend.call('get_entry', { path: existing.path });
        if (value === existing.content)
          return { ...record, reference: `record:${id}`, source: 'journal' };
      } catch {
        /* Durable event is the exact fallback. */
      }
    }
    return { ...record, reference: `record:${id}`, source: 'event-history' };
  }
  async health(): Promise<unknown> {
    const records = (await this.store.events()).flatMap((e) => e.payload.records),
      catalog = await this.catalog();
    return {
      records: records.length,
      pending: records.filter((r) => catalog.get(r.id)?.content !== journalContent(r)).length,
    };
  }
  async close(): Promise<void> {
    await this.backend.close();
  }
}
