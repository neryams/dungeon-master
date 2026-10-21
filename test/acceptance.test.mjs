import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { fixture, apply, record, FileJournal } from './helpers.mjs';
import { CampaignStore } from '../dist/store.js';
import { CampaignService } from '../dist/service.js';
import { JournalAdapter } from '../dist/journal.js';

test('Lantern at Briar Ford: scripted playthrough resumes an interrupted encounter', async (t) => {
  const { store, service } = await fixture(t);
  const example = JSON.parse(await readFile('examples/lantern-ford.json', 'utf8'));
  await apply(service, example.changes);
  await record(service, example.opening);
  const roll = await service.execute('roll_dice', {
    operationId: 'healing-roll',
    expectedRevision: 2,
    reason: 'Player drinks potion',
    expression: '2d4+2',
    purpose: 'Healing potion',
  });
  await apply(service, [
    { type: 'consume_item', id: 'potion', quantity: 1 },
    { type: 'heal', id: 'mara', amount: roll.roll.total },
    {
      type: 'set_encounter',
      encounter: {
        id: 'crossing',
        participants: [
          { id: 'mara', initiative: 16 },
          { id: 'oren', initiative: 9 },
        ],
      },
    },
    { type: 'move_token', map: 'ford-map', id: 'mara', node: 'island' },
  ]);
  const map = (await service.execute('get_campaign_entity', { id: 'ford-map' })).entity;
  map.map.revealed.push('island');
  const oren = (await service.execute('get_campaign_entity', { id: 'oren' })).entity;
  oren.relationships.push({ target: 'mara', description: 'Grateful for accepting the crossing.' });
  await apply(service, [
    { type: 'put_entity', entity: map },
    { type: 'put_entity', entity: oren },
    { type: 'advance_turn' },
  ]);
  await service.execute('checkpoint_session', {
    operationId: randomUUID(),
    expectedRevision: 5,
    reason: 'Pause at river crossing',
    summary: 'Mara used the potion and reached the island. Oren is next to act.',
    dmNotes: 'The keeper and child remain unrevealed.',
    unresolved: ['How does Oren navigate the current?'],
  });
  await rm(join(store.root, '.dm'), { recursive: true });
  const reopened = await CampaignStore.open(store.root),
    fresh = new CampaignService(
      reopened,
      new JournalAdapter(reopened, new FileJournal(reopened.root)),
    );
  const resume = await fresh.execute('resume_campaign', { audience: 'party' });
  assert.equal(resume.revision, 6);
  assert.equal(resume.encounter.turn, 1);
  assert.equal(resume.encounter.round, 1);
  const mara = resume.entities.find((e) => e.id === 'mara');
  assert.equal(mara.character.hp, 12);
  assert.equal(resume.entities.find((e) => e.id === 'potion').item.quantity, 0);
  assert.equal(resume.entities.find((e) => e.id === 'ford-map').map.tokens.mara.node, 'island');
  assert.equal(JSON.stringify(resume).includes('stranded keeper'), false);
  assert.equal(JSON.stringify(resume).includes('far-bank'), false);
  const history = await fresh.execute('search_campaign_history', {
    query: 'Oren reward',
    audience: 'party',
  });
  assert.ok(history.hits.length);
  assert.match(
    (await fresh.execute('get_campaign_entity', { id: 'oren' })).entity.relationships[0]
      .description,
    /Grateful/,
  );
  assert.equal(resume.scene.unresolved[0], 'How does Oren navigate the current?');
});
