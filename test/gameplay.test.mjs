import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, hero, apply, record } from './helpers.mjs';
import { rollDice } from '../dist/domain.js';
import { randomUUID } from 'node:crypto';

test('resources, conditions, items and initiative have exact bookkeeping', async (t) => {
  const { store, service } = await fixture(t);
  await apply(service, [
    { type: 'put_entity', entity: hero },
    { type: 'put_entity', entity: { ...hero, id: 'ally', name: 'Ally' } },
    {
      type: 'put_entity',
      entity: {
        id: 'wand',
        kind: 'item',
        name: 'Wand',
        item: { quantity: 1, owner: 'hero', charges: { current: 3, max: 3 } },
      },
    },
  ]);
  await apply(service, [
    { type: 'resource', id: 'hero', resource: 'slots', delta: -1 },
    { type: 'condition', id: 'hero', name: 'poisoned', duration: 'until cured' },
    { type: 'transfer_item', id: 'wand', owner: 'ally' },
    { type: 'equip_item', id: 'wand', equipped: true },
    { type: 'item_charges', id: 'wand', delta: -1 },
    {
      type: 'set_encounter',
      encounter: {
        id: 'fight',
        participants: [
          { id: 'hero', initiative: 18 },
          { id: 'ally', initiative: 12 },
        ],
      },
    },
  ]);
  await apply(service, [{ type: 'advance_turn' }, { type: 'advance_turn' }]);
  const { state } = await store.read();
  assert.equal(state.encounter.round, 2);
  assert.equal(state.encounter.turn, 0);
  assert.equal(state.entities.hero.character.resources.slots.current, 1);
  assert.equal(state.entities.wand.item.owner, 'ally');
  assert.equal(state.entities.wand.item.charges.current, 2);
  await assert.rejects(
    apply(service, [{ type: 'resource', id: 'hero', resource: 'slots', delta: -2 }]),
  );
  await assert.rejects(apply(service, [{ type: 'item_charges', id: 'wand', delta: 5 }]));
  await apply(service, [{ type: 'condition', id: 'hero', name: 'poisoned', remove: true }]);
  assert.equal((await store.read()).state.entities.hero.character.conditions.length, 0);
});
test('dice retries preserve outcomes, advantage bounds, reported dice', async (t) => {
  const { service } = await fixture(t);
  const input = {
    operationId: 'roll-1',
    expectedRevision: 0,
    reason: 'Attack',
    expression: '1d20+3',
    mode: 'advantage',
    purpose: 'Sword attack',
  };
  const first = await service.execute('roll_dice', input),
    again = await service.execute('roll_dice', input);
  assert.deepEqual(first.roll, again.roll);
  assert.equal(again.duplicate, true);
  assert.equal(first.roll.total, Math.max(...first.roll.dice) + 3);
  assert.deepEqual(
    rollDice('2d6+2', 'normal', () => 0),
    { dice: [1, 1], modifier: 2, total: 4 },
  );
  assert.throws(() => rollDice('1000d6', 'normal'));
  assert.throws(() => rollDice('2d20', 'advantage'));
  assert.throws(() => rollDice('1d1', 'normal'));
  const reported = await service.execute('roll_dice', {
    operationId: 'physical',
    expectedRevision: 1,
    reason: 'Physical roll',
    expression: '1d20',
    mode: 'reported',
    reportedTotal: 17,
    purpose: 'Save',
  });
  assert.equal(reported.roll.total, 17);
  assert.equal(reported.roll.mode, 'reported');
});
test('corrections append compensation, never erase history', async (t) => {
  const { store, service } = await fixture(t);
  await apply(service, [{ type: 'put_entity', entity: hero }]);
  const damage = await apply(service, [{ type: 'damage', id: 'hero', amount: 8 }]);
  await service.execute('correct_campaign_event', {
    operationId: 'correction',
    expectedRevision: 2,
    reason: 'Damage was applied to wrong target',
    eventId: damage.event.id,
    changes: [
      { type: 'heal', id: 'hero', amount: 4 },
      { type: 'set_temp_hp', id: 'hero', amount: 4 },
    ],
  });
  const { events, state } = await store.read();
  assert.equal(events.length, 3);
  assert.equal(events[2].payload.corrects, damage.event.id);
  assert.equal(state.entities.hero.character.hp, 10);
});
test('map movement validates nodes and entity references', async (t) => {
  const { store, service } = await fixture(t);
  await apply(service, [
    { type: 'put_entity', entity: hero },
    {
      type: 'put_entity',
      entity: {
        id: 'map',
        kind: 'map',
        name: 'Map',
        map: {
          kind: 'graph',
          nodes: ['a', 'b'],
          edges: [['a', 'b']],
          tokens: { hero: { node: 'a' } },
        },
      },
    },
  ]);
  await apply(service, [{ type: 'move_token', map: 'map', id: 'hero', node: 'b' }]);
  assert.equal((await store.read()).state.entities.map.map.tokens.hero.node, 'b');
  await assert.rejects(
    apply(service, [{ type: 'move_token', map: 'map', id: 'hero', node: 'missing' }]),
  );
});
test('fresh resume retains world state but party view omits DM entities, rolls and records', async (t) => {
  const { store, service } = await fixture(t);
  await apply(service, [
    { type: 'put_entity', entity: hero },
    {
      type: 'put_entity',
      entity: { id: 'traitor', kind: 'npc', name: 'SECRET', visibility: 'dm', knowledge: 'plan' },
    },
    {
      type: 'put_entity',
      entity: {
        id: 'innkeeper',
        kind: 'npc',
        name: 'Bram',
        interaction: {
          wants: ['Keep the peace'],
          knows: ['The cellar door is barred'],
          disclosed: [],
          offers: [],
          unresolvedTopics: ['Cellar noise'],
          resolvedTopics: [],
          status: 'open',
        },
      },
    },
    {
      type: 'put_entity',
      entity: {
        id: 'distant-envoy',
        kind: 'npc',
        name: 'Envoy',
        interaction: {
          wants: ['Distant treaty'],
          knows: ['Off-screen motive'],
          disclosed: [],
          offers: [],
          unresolvedTopics: [],
          resolvedTopics: [],
          status: 'open',
        },
      },
    },
    { type: 'set_session', session: 's1' },
    {
      type: 'set_scene',
      scene: {
        id: 'hall',
        title: 'Hall',
        present: ['hero', 'traitor', 'innkeeper'],
        unresolved: ['Who opens the door?'],
      },
    },
  ]);
  await record(service, 'The duke promised a boat.');
  await record(service, 'SECRET betrayal plot details stay in the journal', 'dm');
  await service.execute('checkpoint_session', {
    operationId: randomUUID(),
    expectedRevision: 3,
    reason: 'Close session',
    summary: 'The party waits in the hall.',
    dmNotes: 'SECRET betrayal awaits.',
    unresolved: ['Who opens the door?'],
  });
  const dmPacket = await service.execute('resume_campaign', { audience: 'dm' });
  assert.equal(
    JSON.stringify(dmPacket).includes('SECRET betrayal plot details stay in the journal'),
    false,
  );
  assert.deepEqual(
    dmPacket.interactions.map((i) => i.id),
    ['innkeeper'],
  );
  const publicPacket = await service.execute('resume_campaign', { audience: 'party' });
  assert.equal(JSON.stringify(publicPacket).includes('SECRET'), false);
  assert.equal(publicPacket.scene.unresolved[0], 'Who opens the door?');
  assert.equal((await store.read()).state.revision, 4);
  assert.equal(publicPacket.entities[0].character.hp, 10);
  const search = await service.execute('search_campaign_history', {
    query: 'duke',
    audience: 'party',
  });
  assert.equal(JSON.stringify(search).includes('SECRET'), false);
  assert.ok(search.hits.length > 0);
});
