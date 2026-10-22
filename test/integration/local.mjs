// Explicit local-model integration. Requires Ollama + a downloaded multimodal tool model.
// All inference goes through Codex app-server. Journal daemons use private test directories.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import sharp from 'sharp';
import { initialize } from '../../dist/store.js';
import { DesktopHost } from '../../dist/desktop/host.js';
import { CodexSession } from '../../dist/desktop/codex.js';
import { CampaignService } from '../../dist/service.js';
import { JournalAdapter } from '../../dist/journal.js';
import { FileJournal } from '../helpers.mjs';

const local = {
  endpoint: process.env.DM_LOCAL_ENDPOINT ?? 'http://127.0.0.1:11434',
  model: process.env.DM_LOCAL_MODEL ?? 'qwen3.5:9b',
  contextTokens: Number(process.env.DM_LOCAL_CONTEXT ?? 65536),
};
test(
  'local multimodal DM recalls durable journal, applies once, sees map art, compacts and resumes',
  { timeout: 1800000 },
  async () => {
    const parent = await mkdtemp(join(tmpdir(), 'dm-local-live-'));
    console.log(`Local synthetic workspace: ${parent}`);
    const ipc = join(parent, 'ipc'),
      logs = join(parent, 'logs');
    await mkdir(ipc);
    await mkdir(logs);
    let host,
      driver,
      autoCompactions = 0;
    const options = {
      source: resolve('.'),
      env: { TMPDIR: ipc, JOURNAL_RAG_LOG_DIR: logs, JOURNAL_RAG_DEVICE: 'cpu' },
      driver: (config) => {
        driver = new CodexSession({
          ...config,
          progress: (text) => {
            if (text.startsWith('Compacting')) {
              autoCompactions++;
              console.log('Native compaction observed.');
            }
            config.progress(text);
          },
        });
        return driver;
      },
    };
    try {
      const store = await initialize(join(parent, 'campaign'), {
        schemaVersion: 1,
        id: 'local-live',
        name: 'Local synthetic trial',
        edition: '2024',
      });
      await writeFile(
        join(store.root, 'journal-rag.config.json'),
        JSON.stringify({
          sources: ['journal'],
          cachePath: '.journal-rag/index.json',
          embeddingModel: 'invalid:model',
        }),
      );
      await store.transact(
        {
          operationId: 'seed',
          expectedRevision: 0,
          actor: 'test',
          reason: 'Synthetic local-model fixture',
        },
        {},
        () => ({
          changes: [
            {
              type: 'put_entity',
              entity: {
                id: 'mira',
                kind: 'character',
                name: 'Mira',
                character: { hp: 10, maxHp: 10 },
              },
            },
            { type: 'set_party', members: ['mira'] },
            {
              type: 'put_entity',
              entity: { id: 'secret', kind: 'npc', name: 'PRIVATE_LOCAL_SECRET', visibility: 'dm' },
            },
            {
              type: 'put_entity',
              entity: {
                id: 'courtyard',
                kind: 'map',
                name: 'Courtyard',
                map: {
                  kind: 'grid',
                  bounds: { width: 8, height: 8 },
                  revealedRegions: [{ x: 0, y: 0, width: 8, height: 8 }],
                  tokens: { mira: { x: 1, y: 1 } },
                },
              },
            },
          ],
          records: [
            {
              id: 'boat-promise',
              title: 'The ferryman agreement',
              kind: 'scene',
              visibility: 'party',
              content:
                'The ferryman promised Mira a blue boat at dawn. The agreed password is Silver Acorn.',
            },
          ],
        }),
      );
      await sharp({ create: { width: 512, height: 512, channels: 3, background: '#db29cd' } })
        .png()
        .toFile(join(store.root, 'assets/trial.png'));
      const service = new CampaignService(
        store,
        new JournalAdapter(store, new FileJournal(store.root)),
      );
      await service.execute('register_map_art', {
        operationId: 'art',
        expectedRevision: 1,
        reason: 'Synthetic vision fixture',
        mapId: 'courtyard',
        art: {
          path: 'assets/trial.png',
          purpose: 'Synthetic image',
          sourceRevision: 1,
          visibility: 'party',
          background: { extent: { x: 0, y: 0, width: 8, height: 8 } },
        },
      });
      await service.close();
      const connect = async (fresh) => {
        host = new DesktopHost(options);
        await host.open(store.root);
        await host.connect(undefined, fresh, 'ollama', local);
      };
      const submit = async (id, text) => {
        const started = Date.now();
        await host.submit({ id, characterId: 'mira', text });
        for (let i = 0; i < 1300; i++) {
          await new Promise((r) => setTimeout(r, 500));
          const s = await host.snapshot();
          if (s.stage === 'resolving') continue;
          assert.equal(s.stage, 'ready', s.detail);
          const turn = s.table.find((t) => t.id === id);
          assert.equal(turn.status, 'completed');
          assert.ok(turn.messages.length);
          assert.doesNotMatch(JSON.stringify(s), /PRIVATE_LOCAL_SECRET/);
          console.log(
            `${id}: ${Math.round((Date.now() - started) / 1000)}s, revision ${s.revision}`,
          );
          return turn.messages.map((m) => m.text).join('\n');
        }
        throw Error('Local turn timeout');
      };
      await connect(false);
      const first =
        'In this synthetic legacy test, recall the ferryman agreement from saved memory: what boat, when, and what password? Apply exactly 2 damage to Mira with operationId local-damage; this is an explicitly supplied test outcome, no roll or policy change. Save continuity and publish the agreement plus current HP.';
      const answer = await submit('local-first', first);
      assert.match(answer, /blue/i);
      assert.match(answer, /dawn/i);
      assert.match(answer, /Silver Acorn/i);
      assert.equal((await store.read()).state.entities.mira.character.hp, 8);
      const revision = (await store.read()).state.revision;
      assert.equal(
        (await host.submit({ id: 'local-first', characterId: 'mira', text: first })).duplicate,
        true,
      );
      assert.equal((await store.read()).state.revision, revision);
      const vision = await submit(
        'local-vision',
        'Render courtyard with render_location_map audience=party and inspect the returned image. What is the dominant background color? Infer it from the pixels, not metadata. Keep all mechanics unchanged and save a short continuity note before publishing.',
      );
      assert.match(vision, /magenta|pink|purple|violet|fuchsia/i);
      await submit(
        'local-recall',
        'Remind me of the ferryman agreement and my current HP. Do not repeat damage, change mechanics, or invent new promises. Read exact saved records.',
      );
      console.log(`Automatic compactions so far: ${autoCompactions}`);
      if (process.env.DM_REQUIRE_AUTO_COMPACT === '1')
        assert.ok(
          autoCompactions > 0,
          'Native automatic compaction must occur at the test context budget',
        );
      // Explicit maintenance must wait for completion, not the immediate RPC acknowledgment.
      await driver.compact();
      await host.close();
      await connect(false);
      const resumed = await submit(
        'local-resumed',
        'After our pause, what is the ferryman password and my current HP? Reload durable memory. Do not repeat any earlier effects.',
      );
      assert.match(resumed, /Silver Acorn/i);
      assert.equal((await store.read()).state.entities.mira.character.hp, 8);
      assert.equal(
        (await store.events()).filter((e) => e.operationId === 'local-damage').length,
        1,
      );
      assert.ok((await store.events()).filter((e) => e.payload.records.length).length >= 5);
      console.log(
        `Local journal recall, image input, manual compaction, retry and process resume passed; ${autoCompactions} total compaction events observed.`,
      );
    } finally {
      await host?.close();
      for (const name of await readdir(logs)) {
        if (!name.startsWith('mcp-')) continue;
        for (const line of (await readFile(join(logs, name), 'utf8')).split('\n')) {
          try {
            const e = JSON.parse(line);
            if (e.message === 'Spawned daemon process' && Number.isInteger(e.daemonPid))
              process.kill(e.daemonPid, 'SIGTERM');
          } catch {}
        }
      }
      if (!process.env.DM_KEEP_LOCAL_TEST) await rm(parent, { recursive: true, force: true });
    }
  },
);
