import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { initialize } from '../../dist/store.js';
import { JournalAdapter, McpJournal } from '../../dist/journal.js';
import { CampaignService } from '../../dist/service.js';

test(
  'real pinned journal MCP writes, retrieves, and reconciles via isolated daemon',
  { timeout: 60000 },
  async () => {
    const parent = await mkdtemp(join(tmpdir(), 'dm-real-')),
      log = join(parent, 'logs'),
      ipc = join(parent, 'ipc');
    await mkdir(ipc);
    await mkdir(log);
    let service;
    try {
      const store = await initialize(join(parent, 'campaign'), {
        schemaVersion: 1,
        id: 'real',
        name: 'Real integration',
        edition: '2024',
        premise: '',
        tone: 'Adventure',
        houseRules: [],
      });
      // Deliberately invalid model identifier exercises upstream's documented BM25 fallback
      // without a large model download or touching the user's embedding configuration.
      await writeFile(
        join(store.root, 'journal-rag.config.json'),
        JSON.stringify({
          sources: ['journal'],
          cachePath: '.journal-rag/index.json',
          embeddingModel: 'invalid:model',
        }),
      );
      const backend = new McpJournal(store.root, undefined, {
          TMPDIR: ipc,
          JOURNAL_RAG_LOG_DIR: log,
          JOURNAL_RAG_DEVICE: 'cpu',
        }),
        journal = new JournalAdapter(store, backend);
      service = new CampaignService(store, journal);
      const saved = await service.execute('record_scene', {
        operationId: 'real-record',
        expectedRevision: 0,
        reason: 'Integration',
        title: 'Duke promise',
        content: '## Oath\nDuke Alden promised the party a silver ferryboat at dawn.',
      });
      assert.equal(saved.journal.status, 'ready', JSON.stringify(saved.journal));
      const id = saved.event.payload.records[0].id;
      const record = await service.execute('read_campaign_record', { reference: `record:${id}` });
      assert.equal(record.source, 'journal');
      const search = await service.execute('search_campaign_history', {
        query: 'silver ferryboat',
      });
      assert.equal(search.status, 'available');
      assert.ok(
        search.hits.some((h) => h.recordId === id),
        JSON.stringify(search),
      );
      await journal.flush();
      assert.equal(
        (await readdir(join(store.root, 'journal'))).filter((n) => n.endsWith('.md')).length,
        1,
      );
    } finally {
      await service?.close();
      // Only terminate daemon PIDs recorded by this test's private proxy in its private logs.
      for (const name of await readdir(log)) {
        if (!name.startsWith('mcp-')) continue;
        for (const line of (await readFile(join(log, name), 'utf8')).trim().split('\n')) {
          const event = JSON.parse(line);
          if (event.message === 'Spawned daemon process' && Number.isInteger(event.daemonPid)) {
            try {
              process.kill(event.daemonPid, 'SIGTERM');
            } catch {}
          }
        }
      }
      await rm(parent, { recursive: true, force: true });
    }
  },
);
