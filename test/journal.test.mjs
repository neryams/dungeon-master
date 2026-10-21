import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fixture, record } from './helpers.mjs';

test('outage preserves scene then recovery delivers it once', async (t) => {
  const { store, service, backend, journal } = await fixture(t);
  backend.fail = true;
  const result = await record(service);
  assert.equal(result.journal.status, 'pending');
  assert.equal((await store.events()).length, 1);
  const id = result.event.payload.records[0].id;
  assert.equal(
    (await service.execute('read_campaign_record', { reference: `record:${id}` })).source,
    'event-history',
  );
  assert.equal(
    (await service.execute('search_campaign_history', { query: 'duke' })).status,
    'unavailable',
  );
  backend.fail = false;
  assert.equal((await journal.flush()).pending, 0);
  await journal.flush();
  assert.equal(backend.calls.filter((c) => c.name === 'write_entry').length, 2);
  assert.equal(
    (await service.execute('read_campaign_record', { reference: `record:${id}` })).source,
    'journal',
  );
});
test('lost acknowledgement reconciles exact record instead of duplicate delivery', async (t) => {
  const { service, backend, journal } = await fixture(t);
  backend.failAfterWrite = true;
  const result = await record(service);
  assert.equal(result.journal.status, 'pending');
  assert.equal((await journal.flush()).pending, 0);
  assert.equal(backend.calls.filter((c) => c.name === 'write_entry').length, 1);
});
test('modified journal file cannot become canonical history', async (t) => {
  const { service, store, backend, journal } = await fixture(t);
  const result = await record(service);
  const id = result.event.payload.records[0].id;
  await writeFile(
    join(store.root, 'journal', `${id}.md`),
    (await readFile(join(store.root, 'journal', `${id}.md`), 'utf8')).replace('duke', 'impostor'),
  );
  assert.equal((await journal.flush()).status, 'pending');
  const read = await service.execute('read_campaign_record', { reference: `record:${id}` });
  assert.equal(read.source, 'event-history');
  assert.match(read.content, /duke/);
  assert.equal(
    (await service.execute('search_campaign_history', { query: 'impostor' })).hits.length,
    0,
  );
  assert.equal(backend.calls.filter((c) => c.name === 'write_entry').length, 1);
});
