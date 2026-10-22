// Explicit opt-in authenticated CLI test. No direct model API calls.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { initialize, atomicWrite } from '../../dist/store.js';
import { DesktopHost } from '../../dist/desktop/host.js';
import { renderMapImage, schematic } from '../../dist/maps.js';
import sharp from 'sharp';
import { randomUUID } from 'node:crypto';
import { settingsFile } from '../../dist/desktop/antigravity.js';
import { setTimeout as delay } from 'node:timers/promises';

test(
  'authenticated Antigravity hotseat connects, publishes, changes exact state and resumes without duplication',
  { timeout: 1500000 },
  async () => {
    const parent = await mkdtemp(join(tmpdir(), 'dm-hotseat-agy-'));
    const ipc = join(parent, 'ipc'),
      logs = join(parent, 'logs');
    await mkdir(ipc);
    await mkdir(logs);
    const permissionPath = settingsFile();
    let before;
    try {
      before = await readFile(permissionPath, 'utf8');
    } catch {}
    let after;
    let host;
    try {
      const store = await initialize(join(parent, 'campaign'), {
        schemaVersion: 1,
        id: 'hotseat-smoke',
        name: 'Hotseat smoke',
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
          reason: 'Synthetic smoke fixture',
        },
        { fixture: 'hotseat' },
        () => ({
          records: [],
          changes: [
            {
              type: 'put_entity',
              entity: {
                id: 'mira',
                name: 'Mira',
                kind: 'character',
                character: { hp: 10, maxHp: 10 },
              },
            },
            {
              type: 'put_entity',
              entity: {
                id: 'tess',
                name: 'Tess',
                kind: 'character',
                character: { hp: 8, maxHp: 8 },
              },
            },
            {
              type: 'put_entity',
              entity: { id: 'secret', name: 'PRIVATE_SMOKE_SECRET', kind: 'npc', visibility: 'dm' },
            },
            { type: 'set_party', members: ['mira', 'tess'] },
            {
              type: 'put_entity',
              entity: {
                id: 'courtyard',
                name: 'Courtyard',
                kind: 'map',
                map: {
                  kind: 'grid',
                  bounds: { width: 8, height: 8 },
                  revealedRegions: [{ x: 0, y: 0, width: 8, height: 8 }],
                  tokens: { mira: { x: 1, y: 1 }, tess: { x: 2, y: 1 } },
                },
              },
            },
          ],
        }),
      );
      const options = {
        source: resolve('.'),
        env: { TMPDIR: ipc, JOURNAL_RAG_LOG_DIR: logs, JOURNAL_RAG_DEVICE: 'cpu' },
      };
      host = new DesktopHost(options);
      await host.open(store.root);
      try {
        await host.connect();
      } finally {
        after = await readFile(permissionPath, 'utf8');
      }
      const waitForTurn = async () => {
        for (let i = 0; i < 6500; i++) {
          const view = await host.snapshot();
          if (view.stage !== 'resolving') return view;
          await delay(100);
        }
        throw new Error('Smoke turn timed out');
      };
      const request = {
        id: 'smoke-first',
        characterId: 'mira',
        text: 'This is a synthetic integration test in a legacy campaign. Apply exactly 2 damage to Mira, then move Mira to x=3,y=1 on courtyard; no dice or rule review needed for these explicitly supplied test outcomes. Use operationId smoke-damage for damage and smoke-move for movement. Publish a short public confirmation with my resulting HP and position through publish_table_message. Do not mention hidden entities. Do not create any other entities or change review policy.',
      };
      await host.submit(request);
      const view = await waitForTurn();
      assert.equal(view.stage, 'ready', view.detail);
      assert.equal(view.party.members.find((p) => p.id === 'mira').hp, 8);
      assert.deepEqual(view.sheets[0].placements[0].position, { x: 3, y: 1 });
      assert.equal(view.table[0].status, 'completed');
      assert.ok(view.table[0].messages.length > 0);
      assert.doesNotMatch(JSON.stringify(view), /PRIVATE_SMOKE_SECRET/);
      assert.match(
        (await host.map({ mapId: 'courtyard', revision: view.revision })).image,
        /^data:image\/png;base64,/,
      );
      console.log('Live CLI mechanics and public narration passed.');
      const revision = view.revision;
      assert.equal((await host.submit(request)).duplicate, true);
      assert.equal((await host.snapshot()).revision, revision);
      const lan = await host.startLan();
      const lanUrl = new URL(lan.urls[0]);
      async function lanCall(path, data, token) {
        const response = await fetch(`${lanUrl.origin}/api/${path}`, {
          method: data === undefined ? 'GET' : 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token ?? ''}` },
          body: data === undefined ? undefined : JSON.stringify(data),
        });
        const result = await response.json();
        assert.equal(response.status, 200, JSON.stringify(result));
        return result;
      }
      const alice = await lanCall('join', { name: 'Alice', invitation: lanUrl.hash.slice(1) });
      const bob = await lanCall('join', { name: 'Bob', invitation: lanUrl.hash.slice(1) });
      await lanCall('claim', { characterId: 'mira' }, alice.token);
      await lanCall('claim', { characterId: 'tess' }, bob.token);
      async function lanIntent(token, text, sendNow = false) {
        const state = await lanCall('state', undefined, token);
        return lanCall(
          'intent',
          {
            id: randomUUID(),
            epoch: state.gathering.epoch,
            text,
            confirmed: true,
            pass: false,
            sendNow,
          },
          token,
        );
      }
      await lanIntent(
        alice.token,
        'I wait at the courtyard. This is a transport integration check: do not change gameplay. Ask Tess alone whether to inspect the north wall. Publish a responseRequest with characterIds ["tess"], prompt "Tess, inspect the north wall?", kind "decision". Stop and wait for her reply.',
      );
      assert.equal((await host.snapshot()).table.length, 1, 'First player must wait for the group');
      await lanIntent(
        bob.token,
        'I listen. Please ask the targeted question specified by Mira and wait for my next response.',
      );
      const group = await waitForTurn();
      assert.equal(group.stage, 'ready', group.detail);
      assert.equal(group.table.at(-1).actions.length, 2);
      assert.deepEqual(group.gathering.request.characterIds, ['tess']);
      console.log('LAN group submission and targeted prompt passed.');
      await lanIntent(
        bob.token,
        'No, I stay here. Acknowledge my answer without changing mechanics, and return to normal group input without another responseRequest.',
      );
      const answer = await waitForTurn();
      assert.equal(answer.stage, 'ready', answer.detail);
      assert.equal(answer.gathering.request, undefined);
      console.log('Targeted reply passed; starting native image generation through LAN Send now.');
      await lanIntent(
        alice.token,
        'Create and register an illustrated party-safe background for courtyard now using the create-map-art workflow and native generate_image. Use a clean reference at viewport x=0,y=0,width=8,height=8, preserve its square layout, draw a weathered stone courtyard with moss at its edges, no writing or character tokens. Use referencePath for conditioning and import_generated_map_art to save the generated artifact before register_map_art. Inspect the composite and publish the outcome. Do not change geometry, HP, positions, or review policy. Do not pretend generation succeeded if unavailable.',
        true,
      );
      const illustrated = await waitForTurn();
      assert.equal(illustrated.stage, 'ready', illustrated.detail);
      const artState = (await store.read()).state;
      const art = artState.entities.courtyard.map.art?.find((a) => a.background);
      assert.ok(art, JSON.stringify(illustrated.table.at(-1).messages));
      assert.match(art.sha256, /^[a-f0-9]{64}$/);
      assert.deepEqual(art.background.extent, { x: 0, y: 0, width: 8, height: 8 });
      const viewport = art.background.extent;
      const desktopImage = await host.map({
        mapId: 'courtyard',
        revision: illustrated.revision,
        viewport,
      });
      const remoteImage = await lanCall(
        'map',
        { mapId: 'courtyard', revision: illustrated.revision, viewport },
        alice.token,
      );
      assert.equal(remoteImage.image, desktopImage.image);
      const composite = await renderMapImage(store.root, artState, 'courtyard', 'party', viewport);
      assert.deepEqual(desktopImage.warnings, []);
      assert.equal(desktopImage.image, `data:image/png;base64,${composite.png.toString('base64')}`);
      const plain = await sharp(
        Buffer.from(schematic(artState, 'courtyard', 'party', viewport).svg),
      )
        .png()
        .toBuffer();
      assert.notDeepEqual(
        composite.png,
        plain,
        'Desktop must show generated artwork, not only schematic',
      );
      if (process.env.DM_SMOKE_ARTIFACTS) {
        const artifacts = resolve(process.env.DM_SMOKE_ARTIFACTS);
        await mkdir(artifacts, { recursive: true });
        await writeFile(join(artifacts, 'composite.png'), composite.png);
        await writeFile(
          join(artifacts, 'generated.png'),
          await readFile(join(store.root, art.path)),
        );
      }
      await host.close();
      host = new DesktopHost(options);
      await host.open(store.root);
      await host.connect();
      await host.submit({
        id: 'smoke-second',
        characterId: 'tess',
        text: 'I am Tess. Read our current party sheets, then publish a brief public recap of Mira’s HP and position, and my HP. Do not change gameplay or repeat the earlier damage or movement.',
      });
      const resumed = await waitForTurn();
      assert.equal(resumed.stage, 'ready', resumed.detail);
      assert.equal(resumed.table.length, 5);
      assert.equal(resumed.table[4].speaker, 'Tess');
      assert.equal(resumed.party.members.find((p) => p.id === 'mira').hp, 8);
      assert.equal(
        (await store.events()).filter((e) => e.operationId === 'smoke-damage').length,
        1,
      );
      console.log(
        `Authenticated hotseat smoke passed at revision ${resumed.revision}; five public turns, LAN group/targeted/Send now input, native image generation, registered composite and resume verified.`,
      );
    } finally {
      await host?.close();
      // Restore only when the settings still equal our last observed write; don't overwrite concurrent user edits.
      if (after && (await readFile(permissionPath, 'utf8')) === after) {
        if (before !== undefined) await atomicWrite(permissionPath, before);
        else await rm(permissionPath, { force: true });
      }
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
