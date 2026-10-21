import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, rm, readdir, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { fixture, hero, apply, record } from './helpers.mjs';
import { CampaignStore } from '../dist/store.js';
import { exportCampaign, importCampaign } from '../dist/backup.js';

test('replay survives cache deletion and interrupted temporary event', async (t) => {
  const { store, service } = await fixture(t);
  await apply(service, [{ type: 'put_entity', entity: hero }]);
  await apply(service, [{ type: 'damage', id: 'hero', amount: 7 }]);
  const expected = (await store.read()).state;
  assert.equal(expected.entities.hero.character.hp, 7);
  assert.equal(expected.entities.hero.character.tempHp, 0);
  await rm(join(store.root, '.dm/state.json'));
  await writeFile(join(store.root, 'events', 'unfinished.tmp'), '{"broken":');
  assert.deepEqual((await (await CampaignStore.open(store.root)).read()).state, expected);
});
test('one event atomically consumes potion and heals; invalid batches do not persist', async (t) => {
  const { store, service } = await fixture(t);
  await apply(service, [
    { type: 'put_entity', entity: hero },
    {
      type: 'put_entity',
      entity: { id: 'potion', kind: 'item', name: 'Potion', item: { quantity: 1, owner: 'hero' } },
    },
  ]);
  await apply(service, [
    { type: 'consume_item', id: 'potion', quantity: 1 },
    { type: 'heal', id: 'hero', amount: 6 },
  ]);
  const before = await store.read();
  assert.equal(before.state.entities.hero.character.hp, 16);
  assert.equal(before.state.entities.potion.item.quantity, 0);
  await assert.rejects(
    apply(service, [
      { type: 'heal', id: 'hero', amount: 4 },
      { type: 'consume_item', id: 'potion', quantity: 1 },
    ]),
  );
  assert.deepEqual(await store.read(), before);
});
test('duplicates, operation reuse and stale revisions', async (t) => {
  const { store, service } = await fixture(t);
  const input = {
    operationId: 'once',
    expectedRevision: 0,
    reason: 'Create',
    changes: [{ type: 'put_entity', entity: hero }],
  };
  const first = await service.execute('apply_campaign_changes', input),
    again = await service.execute('apply_campaign_changes', input);
  assert.equal(again.duplicate, true);
  assert.equal('state' in first, false);
  assert.equal(first.revision, 1);
  assert.equal(again.event.id, first.event.id);
  await assert.rejects(service.execute('apply_campaign_changes', { ...input, reason: 'Changed' }), {
    code: 'OPERATION_REUSED',
  });
  await assert.rejects(
    service.execute('apply_campaign_changes', { ...input, operationId: 'other' }),
    { code: 'REVISION_CONFLICT' },
  );
  assert.equal((await store.events()).length, 1);
});
test('two writers with the same revision commit only one update', async (t) => {
  const { store, service } = await fixture(t);
  await apply(service, [{ type: 'put_entity', entity: hero }]);
  const other = await CampaignStore.open(store.root);
  const meta = (id) => ({
    operationId: id,
    expectedRevision: 1,
    reason: 'Concurrent',
    actor: 'dm',
  });
  const results = await Promise.allSettled([
    store.transact(meta('a'), { a: 1 }, () => ({
      changes: [{ type: 'damage', id: 'hero', amount: 1 }],
      records: [],
    })),
    other.transact(meta('b'), { b: 1 }, () => ({
      changes: [{ type: 'damage', id: 'hero', amount: 2 }],
      records: [],
    })),
  ]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal((await store.read()).state.revision, 2);
});
test('event gaps and duplicate operation IDs are detected', async (t) => {
  const { store, service } = await fixture(t);
  await apply(service, [{ type: 'put_entity', entity: hero }]);
  const [name] = await readdir(join(store.root, 'events')).then((a) =>
    a.filter((n) => n.endsWith('.json')),
  );
  const event = JSON.parse(await readFile(join(store.root, 'events', name), 'utf8'));
  event.sequence = 3;
  event.id = randomUUID();
  await writeFile(join(store.root, 'events', `0000000003-${event.id}.json`), JSON.stringify(event));
  await assert.rejects(store.read(), { code: 'CORRUPT_HISTORY' });
});
test('export/import rebuilds state and historical records, assets preserved', async (t) => {
  const { store, service, parent } = await fixture(t);
  await apply(service, [{ type: 'put_entity', entity: hero }]);
  const saved = await record(service);
  await writeFile(join(store.root, 'assets', 'map.txt'), 'a map');
  const archive = await exportCampaign(store);
  const imported = await importCampaign(join(parent, 'restored'), archive);
  assert.deepEqual((await imported.read()).state, (await store.read()).state);
  assert.equal(await readFile(join(imported.root, 'assets', 'map.txt'), 'utf8'), 'a map');
  assert.equal(
    (await imported.events())[1].payload.records[0].id,
    saved.event.payload.records[0].id,
  );
});
test('workspace traversal and symlinks cannot escape through record tools', async (t) => {
  const { store, service, parent } = await fixture(t);
  await assert.rejects(
    service.execute('read_campaign_record', { reference: 'record:../../secret' }),
  );
  await writeFile(join(parent, 'secret.md'), 'private');
  await symlink(join(parent, 'secret.md'), join(store.root, 'journal', 'escape.md'));
  await assert.rejects(service.execute('campaign_status', {}), { code: 'INVALID_PATH' });
});
test('malicious archive assets fail before creating a destination', async (t) => {
  const { store, parent } = await fixture(t);
  const archive = await exportCampaign(store);
  archive.assets.push({ path: 'assets/../../escape', base64: '' });
  await assert.rejects(importCampaign(join(parent, 'restored'), archive), {
    code: 'INVALID_ARCHIVE',
  });
});
