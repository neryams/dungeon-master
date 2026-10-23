import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { join, resolve } from 'node:path';
import { cp, mkdir, symlink, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { fixture, hero, apply } from './helpers.mjs';
import { CampaignStore } from '../dist/store.js';
import { exportCampaign, importCampaign } from '../dist/backup.js';
import { CampaignService } from '../dist/service.js';
import { partyState } from '../dist/domain.js';
import { startPanel } from '../dist/panel.js';
const referee = { host: 'isolated-test-host', model: 'inherited' };
const citations = [{ source: 'srd-5.2.1', page: 6, reference: 'Ability Checks' }];
const ruling = {
  verdict: 'allowed',
  reasoning: 'Test procedure',
  citations,
  costs: 'One slot on failure',
  procedure: 'Roll 1d20+3 against DC15',
  success: 'No mechanical effect',
  failure: 'Spend one slot',
  rolls: [
    {
      id: 'check',
      expression: '1d20+3',
      mode: 'normal',
      purpose: 'SECRET target DC15',
      visibility: 'party',
      when: 'Immediately',
      optional: false,
    },
  ],
  referee,
};
async function mutate(service, name, data, extra = {}) {
  return service.execute(name, {
    operationId: randomUUID(),
    expectedRevision: (await service.store.read()).state.revision,
    reason: 'Isolated referee test',
    ...data,
    ...extra,
  });
}
async function setup(t) {
  const f = await fixture(t);
  await apply(f.service, [
    { type: 'put_entity', entity: hero },
    {
      type: 'put_entity',
      entity: {
        id: 'grid',
        kind: 'map',
        name: 'Grid',
        map: {
          kind: 'grid',
          bounds: { width: 20, height: 20 },
          revealedRegions: [{ x: 0, y: 0, width: 20, height: 20 }],
          tokens: { hero: { x: 1, y: 1 } },
        },
      },
    },
  ]);
  await mutate(f.service, 'configure_review', { mode: 'reviewed' });
  return f;
}
async function prepare(service, id = 'action') {
  return mutate(service, 'prepare_action', {
    actionId: id,
    actors: ['hero'],
    intent: 'Attempt the task',
    circumstances: 'SECRET details',
    entityIds: ['grid'],
  });
}
async function rule(service, id = 'action', value = ruling) {
  return mutate(service, 'record_action_ruling', { actionId: id, ruling: value });
}
async function roll(service, id = 'action', extra = {}) {
  return mutate(
    service,
    'roll_dice',
    {
      actionId: id,
      stepId: 'check',
      expression: '1d20+3',
      mode: 'reported',
      reportedTotal: 8,
      purpose: 'SECRET target DC15',
      visibility: 'party',
    },
    extra,
  );
}
const effects = [{ type: 'resource', id: 'hero', resource: 'slots', delta: -1 }];
async function approve(service, id = 'action', changes = effects) {
  return mutate(service, 'approve_action_effects', {
    actionId: id,
    approval: { reasoning: '8 is below 15; apply recorded cost', referee, citations, changes },
  });
}

test('reviewed workflow records procedure, recovers dice, approves exact effects and commits once', async (t) => {
  const { service, store } = await setup(t);
  await prepare(service);
  await assert.rejects(roll(service), /allowed ruling/);
  await rule(service);
  await assert.rejects(
    mutate(service, 'roll_dice', {
      actionId: 'action',
      stepId: 'check',
      expression: '1d20+99',
      purpose: 'Changed',
      mode: 'reported',
      reportedTotal: 8,
    }),
    /differs/,
  );
  await assert.rejects(
    roll(service, 'action', { reportedTotal: 100 }),
    /outside the expression bounds/,
  );
  const operationId = randomUUID(),
    expectedRevision = (await store.read()).state.revision;
  const first = await roll(service, 'action', { operationId, expectedRevision });
  const duplicate = await roll(service, 'action', { operationId, expectedRevision });
  assert.equal(duplicate.duplicate, true);
  assert.deepEqual(first.roll, duplicate.roll);
  await assert.rejects(roll(service), /already rolled/);
  await assert.rejects(
    rule(service, 'action', { ...ruling, procedure: 'Always succeed' }),
    /Cannot change outcome terms/,
  );
  await assert.rejects(
    mutate(service, 'configure_review', { mode: 'legacy' }),
    /Close pending actions/,
  );
  await assert.rejects(
    approve(service, 'action', [{ type: 'resource', id: 'hero', resource: 'slots', delta: -99 }]),
    /negative/,
  );
  assert.equal(
    (await service.execute('get_action', { actionId: 'action' })).action.status,
    'ruled',
  );
  await approve(service);
  const meta = { operationId: randomUUID(), expectedRevision: (await store.read()).state.revision };
  const committed = await mutate(
    service,
    'commit_action',
    { actionId: 'action', publicExplanation: 'The attempt failed and spent a slot.' },
    meta,
  );
  assert.equal((await store.read()).state.entities.hero.character.resources.slots.current, 1);
  const again = await mutate(
    service,
    'commit_action',
    { actionId: 'action', publicExplanation: 'The attempt failed and spent a slot.' },
    meta,
  );
  assert.equal(again.duplicate, true);
  assert.equal(again.event.id, committed.event.id);
  await assert.rejects(mutate(service, 'commit_action', { actionId: 'action' }), /closed/);
});

test('guards cover raw writes, replacement, movement, correction and administrative invariants', async (t) => {
  const { service, store } = await setup(t);
  for (const change of [
    { type: 'damage', id: 'hero', amount: 1 },
    { type: 'set_time', time: 'Tomorrow' },
    { type: 'put_entity', entity: { id: 'hero', kind: 'npc', name: 'Replacement' } },
    { type: 'set_positions', map: 'grid', positions: [{ entityId: 'hero', x: 2, y: 2 }] },
    { type: 'set_map', id: 'grid', map: { kind: 'grid' } },
  ])
    await assert.rejects(apply(service, [change]), { code: 'REVIEW_REQUIRED' });
  await assert.rejects(
    mutate(service, 'update_map_positions', {
      mapId: 'grid',
      positions: [{ entityId: 'hero', x: 2, y: 2 }],
    }),
    { code: 'REVIEW_REQUIRED' },
  );
  await assert.rejects(
    mutate(service, 'create_location_map', {
      entity: {
        id: 'another',
        kind: 'map',
        name: 'Another',
        map: { kind: 'grid', bounds: { width: 2, height: 2 } },
      },
    }),
    { code: 'REVIEW_REQUIRED' },
  );
  await assert.rejects(
    mutate(service, 'correct_campaign_event', {
      eventId: (await store.events())[0].id,
      changes: effects,
    }),
    { code: 'REVIEW_REQUIRED' },
  );
  await assert.rejects(
    mutate(service, 'roll_dice', { expression: '1d20', purpose: 'Unreviewed' }),
    { code: 'REVIEW_REQUIRED' },
  );
  await assert.rejects(
    mutate(service, 'administer_campaign', {
      purpose: 'override',
      ruling: 'Spend missing resource',
      changes: [{ type: 'resource', id: 'hero', resource: 'slots', delta: -99 }],
    }),
    /negative/,
  );
  await assert.rejects(
    mutate(service, 'administer_campaign', {
      purpose: 'override',
      ruling: 'Correction',
      reason: ' ',
      changes: [],
    }),
    /too_small|at least|character/,
  );
  await mutate(service, 'administer_campaign', {
    purpose: 'world_preparation',
    ruling: 'Add a new opponent',
    changes: [{ type: 'put_entity', entity: { ...hero, id: 'opponent' } }],
  });
  await apply(service, [
    { type: 'set_scene', scene: { id: 'scene', title: 'A choice', present: ['hero'] } },
  ]);
  await mutate(service, 'set_map_reveal', {
    mapId: 'grid',
    revealed: false,
    cells: [{ x: 0, y: 0 }],
  });
});

test('stale actions preserve rolls, require renewed review and cannot silently alter pre-roll terms', async (t) => {
  const { service, store } = await setup(t);
  await prepare(service);
  await rule(service);
  await roll(service);
  await approve(service);
  await mutate(service, 'administer_campaign', {
    purpose: 'correction',
    ruling: 'Correct unrelated health and inventory',
    changes: [
      { type: 'damage', id: 'hero', amount: 1 },
      {
        type: 'put_entity',
        entity: {
          id: 'new-item',
          kind: 'item',
          name: 'New item',
          item: { owner: 'hero', quantity: 1 },
        },
      },
    ],
  });
  assert.equal((await service.execute('get_action', { actionId: 'action' })).status, 'stale');
  await assert.rejects(mutate(service, 'commit_action', { actionId: 'action' }), {
    code: 'STALE_REVIEW',
  });
  await mutate(service, 'supersede_action', { actionId: 'action', replacementId: 'replacement' });
  await assert.rejects(approve(service, 'replacement'), /allowed ruling/);
  const next = await service.execute('get_action', { actionId: 'replacement' });
  assert.equal(next.action.rolls[0].total, 8);
  assert.ok(next.action.packet.entities.some((e) => e.id === 'new-item'));
  await rule(service, 'replacement');
  await assert.rejects(roll(service, 'replacement'), /already rolled/);
  await approve(service, 'replacement');
  await mutate(service, 'commit_action', { actionId: 'replacement' });
  assert.equal((await store.read()).state.entities.hero.character.resources.slots.current, 1);
});

test('narrative-only events do not stale approval; optional steps and amendments are explicit', async (t) => {
  const { service } = await setup(t);
  await prepare(service);
  await rule(service);
  await assert.rejects(approve(service), /Resolve all roll steps/);
  await mutate(service, 'amend_action_rolls', {
    actionId: 'action',
    referee,
    citations,
    rolls: [
      {
        id: 'followup',
        expression: '1d6',
        purpose: 'Only on success',
        when: 'Check succeeds',
        optional: true,
      },
    ],
  });
  await roll(service);
  await mutate(service, 'approve_action_effects', {
    actionId: 'action',
    approval: {
      reasoning: 'Failure means no followup',
      referee,
      citations,
      changes: effects,
      skippedRolls: [{ stepId: 'followup', reason: 'Check failed' }],
    },
  });
  await mutate(service, 'record_scene', {
    title: 'Narrative checkpoint',
    content: 'The attempt is being resolved.',
    visibility: 'party',
  });
  await mutate(service, 'commit_action', { actionId: 'action' });
});

test('fallback and override explicitly retain reason and ruling, including administrative dice', async (t) => {
  const { service, store } = await setup(t);
  await prepare(service);
  await rule(service, 'action', { ...ruling, verdict: 'not_possible' });
  await assert.rejects(roll(service), /allowed ruling/);
  await mutate(service, 'administer_campaign', {
    actionId: 'action',
    closeAction: false,
    purpose: 'delegation_unavailable',
    ruling: 'DM procedure: roll 1d20+3 against DC15; failure spends one slot.',
  });
  await mutate(service, 'administer_campaign', {
    actionId: 'action',
    purpose: 'delegation_unavailable',
    ruling: 'Apply previously recorded DM procedure',
    roll: { expression: '1d20+3', mode: 'reported', reportedTotal: 8, purpose: 'Fallback check' },
  });
  await mutate(service, 'administer_campaign', {
    actionId: 'action',
    purpose: 'delegation_unavailable',
    ruling: '8 fails DC15; spend a slot',
    changes: effects,
  });
  const events = await store.events();
  assert.equal(events.at(-1).payload.review.purpose, 'delegation_unavailable');
  assert.equal(events.at(-2).payload.roll.total, 8);
});

test('restart/export restore unfinished actions; player views do not expose private review data', async (t) => {
  const { service, store, parent } = await setup(t);
  await prepare(service);
  await rule(service);
  await roll(service);
  assert.equal((await service.resume('dm')).pendingActions[0].id, 'action');
  assert.doesNotMatch(
    JSON.stringify(await service.resume('party')),
    /SECRET|pendingActions|actionId/,
  );
  assert.equal(partyState((await store.read()).state).actions, undefined);
  await assert.rejects(service.execute('get_action', { actionId: 'action', audience: 'party' }), {
    code: 'NOT_FOUND',
  });
  const imported = await importCampaign(join(parent, 'restored'), await exportCampaign(store));
  assert.deepEqual((await imported.read()).state, (await store.read()).state);
  const fresh = new CampaignService(await CampaignStore.open(imported.root), service.journal);
  await approve(fresh);
  await mutate(fresh, 'commit_action', {
    actionId: 'action',
    publicExplanation: 'A failed attempt.',
  });
  assert.deepEqual(await fresh.execute('get_action', { actionId: 'action', audience: 'party' }), {
    revision: (await imported.read()).state.revision,
    publicExplanation: 'A failed attempt.',
  });
  const panel = await startPanel(store.root, { port: 0 });
  t.after(() => panel.close());
  const body = await (
    await fetch(`http://127.0.0.1:${panel.port}/api/state`, {
      headers: { Authorization: `Bearer ${panel.token}` },
    })
  ).text();
  assert.doesNotMatch(body, /SECRET|pendingActions|reviewMode/);
});

test('rules use explicit editions and valid source/page citations; legacy remains writable', async (t) => {
  const { service } = await fixture(t);
  await apply(service, [{ type: 'put_entity', entity: hero }]);
  await apply(service, effects);
  const found = await service.execute('search_rules', { query: 'long jump', edition: '2014' });
  assert.equal(found.source.id, 'srd-5.1');
  assert.ok(found.hits.length);
  const jumping = await service.execute('search_rules', {
    query: 'Long Jump',
    format: 'pages',
    edition: '2024',
    limit: 4,
  });
  assert.ok(jumping.hits.some((h) => h.page === 184 || h.page === 185));
  const potions = await service.execute('search_rules', {
    query: 'Potion of Healing',
    format: 'pages',
    edition: '2024',
    limit: 5,
  });
  assert.ok(potions.hits.some((h) => h.page === 99));
  const page = await service.execute('read_rules', { edition: '2024', page: 6 });
  assert.match(page.pages[0].text, /Ability Checks/);
  assert.equal(page.source.id, 'srd-5.2.1');
  await mutate(service, 'prepare_action', {
    actionId: 'a',
    actors: ['hero'],
    intent: 'Check',
    circumstances: 'Ordinary',
  });
  await assert.rejects(
    rule(service, 'a', {
      ...ruling,
      citations: [{ source: 'srd-5.1', page: 1, reference: 'Wrong edition' }],
    }),
    { code: 'INVALID_CITATION' },
  );
  await rule(service, 'a', {
    ...ruling,
    rolls: [],
    procedure: 'No dice',
    costs: 'None',
    success: 'Proceed',
    failure: 'Not applicable',
  });
  await approve(service, 'a', []);
  await mutate(service, 'commit_action', { actionId: 'a' });
});

test('Briar Ford reviewed potion resolves actual dice with inventory and scene progress together', async (t) => {
  const { readFile } = await import('node:fs/promises');
  const { service, store } = await fixture(t);
  const adventure = JSON.parse(await readFile('examples/lantern-ford.json', 'utf8'));
  const example = JSON.parse(await readFile('examples/referee-action.json', 'utf8'));
  await apply(service, adventure.changes);
  await mutate(service, 'configure_review', { mode: 'reviewed' });
  await mutate(service, 'prepare_action', example.prepare);
  await rule(service, example.prepare.actionId, example.ruling);
  const before = (await store.read()).state;
  const result = await mutate(service, 'roll_dice', {
    actionId: example.prepare.actionId,
    stepId: 'healing',
    expression: '2d4+2',
    mode: 'normal',
    purpose: 'Ordinary Potion of Healing',
    visibility: 'party',
  });
  const changes = [
    { type: 'consume_item', id: 'potion', quantity: 1 },
    { type: 'heal', id: 'mara', amount: result.roll.total },
    {
      type: 'set_scene',
      scene: {
        ...before.scene,
        progress: [
          ...(before.scene.progress ?? []),
          'Mara used her bonus action to drink the potion.',
        ],
      },
    },
  ];
  await mutate(service, 'approve_action_effects', {
    actionId: example.prepare.actionId,
    approval: {
      referee,
      citations: example.ruling.citations,
      reasoning: 'Apply actual healing roll, consume potion and record action use.',
      changes,
    },
  });
  await mutate(service, 'commit_action', {
    actionId: example.prepare.actionId,
    publicExplanation: 'Mara drank her healing potion.',
  });
  const after = (await store.read()).state;
  assert.equal(after.entities.potion.item.quantity, 0);
  assert.equal(
    after.entities.mara.character.hp,
    Math.min(
      before.entities.mara.character.maxHp,
      before.entities.mara.character.hp + result.roll.total,
    ),
  );
  assert.match(after.scene.progress.at(-1), /bonus action/);
});

test('section citations survive replay, export and exact retries; invalid new citations do not write', async (t) => {
  const { service, store, parent } = await setup(t);
  await prepare(service);
  const search = await service.execute('search_rules', { query: 'Ability Checks' });
  const hit = search.hits[0];
  const cited = {
    ...ruling,
    citations: [
      {
        source: search.source.id,
        reference: hit.title,
        sectionId: hit.id,
        corpusRevision: hit.corpusRevision,
      },
    ],
  };
  const input = {
    operationId: randomUUID(),
    expectedRevision: (await store.read()).state.revision,
    reason: 'Section reference',
    actionId: 'action',
    ruling: cited,
  };
  await service.execute('record_action_ruling', input);
  assert.equal((await service.execute('record_action_ruling', input)).duplicate, true);
  const events = await store.events();
  await assert.rejects(
    mutate(service, 'record_action_ruling', {
      actionId: 'action',
      ruling: { ...cited, citations: [{ ...cited.citations[0], corpusRevision: 'obsolete' }] },
    }),
    { code: 'INVALID_CITATION' },
  );
  assert.deepEqual(await store.events(), events);
  const imported = await importCampaign(
    join(parent, 'section-restore'),
    await exportCampaign(store),
  );
  assert.deepEqual(await imported.events(), events);
  const fresh = new CampaignService(await CampaignStore.open(imported.root), service.journal);
  const resumed = await fresh.execute('get_action', { actionId: 'action' });
  assert.deepEqual(resumed.action.ruling.citations, cited.citations);
  await mutate(fresh, 'amend_action_rolls', {
    actionId: 'action',
    rolls: [
      { id: 'extra', expression: '1d20', purpose: 'Extra test', when: 'Optional', optional: true },
    ],
    referee,
    citations: cited.citations,
  });
  await roll(fresh);
  await mutate(fresh, 'approve_action_effects', {
    actionId: 'action',
    approval: {
      reasoning: 'Apply cost',
      referee,
      citations: cited.citations,
      changes: effects,
      skippedRolls: [{ stepId: 'extra', reason: 'Not required' }],
    },
  });
  await mutate(fresh, 'commit_action', {
    actionId: 'action',
    publicExplanation: 'Test resolution',
  });
  assert.equal((await imported.read()).state.entities.hero.character.resources.slots.current, 1);
  // A later host can replay and recover a saved operation without its old corpus.
  const runtime = join(parent, 'runtime');
  await mkdir(runtime);
  await cp(resolve('dist'), join(runtime, 'dist'), { recursive: true });
  await writeFile(join(runtime, 'package.json'), '{"type":"module"}');
  await symlink(resolve('node_modules'), join(runtime, 'node_modules'), 'dir');
  const { CampaignService: OfflineService } = await import(
    pathToFileURL(join(runtime, 'dist/service.js')).href
  );
  const offline = new OfflineService(await CampaignStore.open(imported.root), service.journal);
  assert.equal((await offline.execute('record_action_ruling', input)).duplicate, true);
  await assert.rejects(offline.execute('read_rules', { sectionId: hit.id }), {
    code: 'RULES_UNAVAILABLE',
  });
  await mkdir(join(runtime, 'rules'));
  await writeFile(join(runtime, 'rules/srd-5.2.1-sections.json'), '{"sections":[]}');
  await assert.rejects(offline.execute('search_rules', { query: 'Jump' }), {
    code: 'RULES_UNAVAILABLE',
  });
  assert.deepEqual(
    (await offline.execute('get_action', { actionId: 'action' })).action.ruling.citations,
    cited.citations,
  );
});

test('roll visibility defaults are independent from planned visibility', async (t) => {
  const { service, store } = await setup(t);

  await prepare(service, 'dm-planned');
  await rule(service, 'dm-planned', {
    ...ruling,
    rolls: [
      {
        id: 'check',
        expression: '1d20+3',
        mode: 'normal',
        purpose: 'Private procedure',
        visibility: 'dm',
        when: 'Immediately',
        optional: false,
      },
    ],
  });
  const dmPlan = await service.execute('get_action', { actionId: 'dm-planned' });
  assert.equal(dmPlan.action.ruling.rolls[0].visibility, 'dm');
  const dmPurpose = dmPlan.action.ruling.rolls[0].purpose;
  const omittedVisibility = await mutate(service, 'roll_dice', {
    actionId: 'dm-planned',
    stepId: 'check',
    expression: '1d20+3',
    mode: 'reported',
    reportedTotal: 8,
    purpose: dmPurpose,
  });
  assert.equal(omittedVisibility.roll.visibility, 'party');
  await mutate(service, 'approve_action_effects', {
    actionId: 'dm-planned',
    approval: { reasoning: 'Resolve the check', referee, citations, changes: [] },
  });
  await mutate(service, 'commit_action', { actionId: 'dm-planned' });

  await prepare(service, 'party-planned');
  await rule(service, 'party-planned', {
    ...ruling,
    rolls: [
      {
        id: 'check',
        expression: '1d20+3',
        mode: 'normal',
        purpose: 'Check',
        visibility: 'party',
        when: 'Immediately',
        optional: false,
      },
    ],
  });
  const explicitlyPrivate = await mutate(service, 'roll_dice', {
    actionId: 'party-planned',
    stepId: 'check',
    expression: '1d20+3',
    mode: 'reported',
    reportedTotal: 8,
    purpose: 'Check',
    visibility: 'dm',
  });
  assert.equal(explicitlyPrivate.roll.visibility, 'dm');
  await mutate(service, 'approve_action_effects', {
    actionId: 'party-planned',
    approval: { reasoning: 'Resolve the check', referee, citations, changes: [] },
  });
  await mutate(service, 'commit_action', { actionId: 'party-planned' });

  await prepare(service, 'amended-plan');
  await rule(service, 'amended-plan', { ...ruling, rolls: [] });
  await mutate(service, 'amend_action_rolls', {
    actionId: 'amended-plan',
    referee,
    citations,
    rolls: [
      {
        id: 'followup',
        expression: '1d6',
        purpose: 'Followup check',
        when: 'If needed',
        optional: true,
      },
    ],
  });
  assert.equal(
    (await service.execute('get_action', { actionId: 'amended-plan' })).action.ruling.rolls[0]
      .visibility,
    'party',
  );
  await mutate(service, 'approve_action_effects', {
    actionId: 'amended-plan',
    approval: {
      reasoning: 'The optional check was unnecessary',
      referee,
      citations,
      changes: [],
      skippedRolls: [{ stepId: 'followup', reason: 'Not required' }],
    },
  });
  await mutate(service, 'commit_action', { actionId: 'amended-plan' });

  await mutate(service, 'administer_campaign', {
    purpose: 'world_preparation',
    ruling: 'Resolve a public table check.',
    roll: {
      expression: '1d20',
      mode: 'reported',
      reportedTotal: 12,
      purpose: 'Initiative check',
    },
  });
  const events = await store.read();
  const adminRoll = events.events.findLast(
    (event) => event.payload.roll?.purpose === 'Initiative check',
  );
  assert.equal(adminRoll.payload.roll.visibility, 'party');

  await prepare(service, 'explicitly-hidden');
  await rule(service, 'explicitly-hidden', {
    ...ruling,
    rolls: [
      {
        id: 'check',
        expression: '1d20+3',
        mode: 'normal',
        purpose: 'Private procedure',
        visibility: 'dm',
        when: 'Immediately',
        optional: false,
      },
    ],
  });
  const explicitlyHidden = await mutate(service, 'roll_dice', {
    actionId: 'explicitly-hidden',
    stepId: 'check',
    expression: '1d20+3',
    mode: 'reported',
    reportedTotal: 8,
    purpose: 'Private procedure',
    visibility: 'dm',
  });
  assert.equal(explicitlyHidden.roll.visibility, 'dm');
});
