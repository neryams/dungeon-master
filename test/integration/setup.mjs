// Opt-in live Codex check: uses CLI-managed sign-in and account usage, never a model API.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import { DesktopHost } from '../../dist/desktop/host.js';

test(
  'live Codex guides campaign setup, generates a delegated opening and resumes it',
  { timeout: 1500000 },
  async () => {
    const parent = await mkdtemp(join(tmpdir(), 'dm-setup-'));
    const ipc = join(parent, 'ipc'),
      logs = join(parent, 'logs');
    await mkdir(ipc);
    await mkdir(logs);
    const options = {
      source: resolve('.'),
      env: { TMPDIR: ipc, JOURNAL_RAG_LOG_DIR: logs, JOURNAL_RAG_DEVICE: 'cpu' },
    };
    let host = new DesktopHost(options);
    async function settled() {
      for (let i = 0; i < 6500; i++) {
        const view = await host.snapshot();
        if (view.stage !== 'resolving') {
          assert.equal(view.stage, 'ready', view.detail);
          return view;
        }
        await delay(100);
      }
      assert.fail('Setup turn timed out');
    }
    try {
      const created = await host.create({
        parent,
        slug: 'campaign',
        name: 'Setup smoke',
        edition: '2024',
      });
      assert.equal(created.reviewMode, 'setup');
      await writeFile(
        join(created.root, 'journal-rag.config.json'),
        JSON.stringify({
          sources: ['journal'],
          cachePath: '.journal-rag/index.json',
          embeddingModel: 'invalid:model',
        }),
      );
      await host.connect(undefined, false, 'codex');
      await host.beginSetup();
      const question = await settled();
      assert.equal(question.reviewMode, 'setup');
      assert.equal(question.table.length, 1);
      assert.ok(
        question.table[0].messages.length,
        'The opening DM question must be public and saved',
      );
      console.log(
        'Live setup introduction saved:',
        question.table[0].messages.map((m) => m.text).join('\n'),
      );
      await host.beginSetup();
      assert.equal((await host.snapshot()).revision, question.revision);
      await host.submit({
        id: 'setup-preferences',
        text: 'Surprise me with a short, friendly mystery for two level-1 characters using the saved 2024 edition. Generate both characters and their starting equipment, choose their bonds and goals, and decide the setting and all remaining preferences. Keep it family-friendly, low difficulty, with no horror or graphic violence. I prefer a single evening adventure. Skip illustrated artwork; a schematic map is enough. You have my approval to choose all remaining details and create the complete playable opening now. Save an explicit party roster, opening quest/objective, scene with an immediate decision, and a revealed starting map with both characters placed. Verify the saved opening and render the map, then enable reviewed play. Stop at the first decision for the players; do not take their actions.',
      });
      const opening = await settled();
      assert.equal(
        opening.reviewMode,
        'reviewed',
        'The delegated opening must finish campaign setup',
      );
      assert.equal(opening.party.members.length, 2);
      assert.ok(opening.maps.length);
      assert.ok(opening.scene?.pendingDecision);
      assert.ok(opening.focus?.primaryObjective);
      assert.ok(opening.sheets.every((s) => s.placements.length));
      assert.ok(opening.table.every((turn) => turn.status === 'completed' && turn.messages.length));
      const map = await host.map({
        mapId: opening.scene.map ?? opening.maps[0].id,
        revision: opening.revision,
      });
      assert.match(map.image, /^data:image\/png;base64,/);
      await host.close();
      host = new DesktopHost(options);
      await host.open(created.root);
      await host.connect(undefined, false, 'codex');
      await host.beginSetup();
      const restored = await host.snapshot();
      assert.equal(restored.revision, opening.revision);
      assert.deepEqual(restored.party, opening.party);
      assert.deepEqual(restored.table, opening.table);
      console.log(
        `Live setup passed at revision ${restored.revision}: saved questions, generated party/map/opening, reviewed transition and restart without replay.`,
      );
    } finally {
      await host.close();
      // Only terminate daemon PIDs recorded in this test's private proxy logs.
      for (const name of await readdir(logs)) {
        if (!name.startsWith('mcp-')) continue;
        for (const line of (await readFile(join(logs, name), 'utf8')).trim().split('\n')) {
          let event;
          try {
            event = JSON.parse(line);
          } catch {
            continue;
          }
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
