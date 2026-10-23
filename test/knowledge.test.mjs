import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { CampaignStore } from '../dist/store.js';
import { exportCampaign, importCampaign } from '../dist/backup.js';
import { partyState } from '../dist/domain.js';
import { initialState } from '../dist/schema.js';
import { apply, fixture, hero } from './helpers.mjs';

const fact = {
  id: 'duke-secret',
  truthKind: 'claim',
  truth: 'The duke claims the lighthouse is abandoned.',
  entityIds: ['duke', 'lighthouse'],
  knownBy: ['hero', 'duke'],
  observableDescription: 'Fresh smoke rises from the sealed lighthouse.',
  discoveryHints: ['Look for recent signs of occupancy.'],
  disclosures: [
    {
      recipient: { type: 'character', id: 'hero' },
      text: 'The duke said the lighthouse is abandoned.',
      kind: 'reported',
      evidence: 'The party heard the duke say this at court.',
    },
    {
      recipient: { type: 'party' },
      text: 'Smoke is visible above the lighthouse.',
      kind: 'observed',
      evidence: 'The party saw smoke from the harbor.',
    },
  ],
};

test('knowledge is event-backed, retry-safe, DM-retrievable and absent from party projections', async (t) => {
  const f = await fixture(t);
  await apply(f.service, [
    { type: 'put_entity', entity: hero },
    { type: 'put_entity', entity: { id: 'duke', kind: 'npc', name: 'Duke' } },
    { type: 'put_entity', entity: { id: 'lighthouse', kind: 'location', name: 'Lighthouse' } },
  ]);
  const status = await f.service.execute('campaign_status', {});
  const mutation = {
    operationId: 'knowledge-op',
    expectedRevision: status.revision,
    reason: 'Record newly learned evidence',
    changes: [{ type: 'set_knowledge', fact }],
  };
  const first = await f.service.execute('apply_campaign_changes', mutation);
  const retry = await f.service.execute('apply_campaign_changes', mutation);
  assert.equal(first.event.id, retry.event.id);
  assert.equal(retry.duplicate, true);

  const dmFact = await f.service.execute('get_campaign_knowledge', { id: fact.id });
  assert.equal(dmFact.fact.truthKind, 'claim');
  assert.equal(dmFact.fact.disclosures.length, 2);
  assert.equal(dmFact.fact.disclosures[1].kind, 'observed');
  await assert.rejects(
    f.service.execute('get_campaign_knowledge', { id: fact.id, audience: 'party' }),
    (error) => error.code === 'NOT_FOUND',
  );

  const dmResume = await f.service.execute('resume_campaign', { audience: 'dm' });
  assert.equal(dmResume.knowledgeFactCount, 1);
  assert.equal(dmResume.knowledgeFactsTruncated, false);
  assert.equal(dmResume.knowledgeFacts[0].id, fact.id);
  const partyResume = await f.service.execute('resume_campaign', { audience: 'party' });
  assert.equal('knowledgeFacts' in partyResume, false);
  const party = partyState((await f.store.read()).state);
  assert.equal('knowledge' in party, false);

  const reopened = await CampaignStore.open(f.store.root);
  const replayed = (await reopened.read()).state;
  assert.equal(replayed.knowledge[fact.id].truthKind, 'claim');
  assert.equal(replayed.knowledge[fact.id].disclosures[0].text, fact.disclosures[0].text);
  const imported = await importCampaign(
    join(f.parent, 'restored-campaign'),
    await exportCampaign(f.store),
  );
  const importedState = (await imported.read()).state;
  assert.equal(importedState.knowledge[fact.id].observableDescription, fact.observableDescription);
  assert.equal(importedState.knowledge[fact.id].disclosures.length, 2);
});

test('knowledge references validate and legacy state without a ledger remains readable', async (t) => {
  const f = await fixture(t);
  await apply(f.service, [
    { type: 'put_entity', entity: hero },
    { type: 'put_entity', entity: { id: 'lighthouse', kind: 'location', name: 'Lighthouse' } },
  ]);
  await assert.rejects(
    apply(f.service, [
      {
        type: 'set_knowledge',
        fact: { ...fact, id: 'dangling', entityIds: ['missing'] },
      },
    ]),
    /Unknown entity: missing/,
  );
  await assert.rejects(
    apply(f.service, [
      {
        type: 'set_knowledge',
        fact: {
          ...fact,
          id: 'bad-holder',
          entityIds: ['lighthouse'],
          knownBy: ['lighthouse'],
        },
      },
    ]),
    /Knowledge holders must be characters or NPCs/,
  );
  const legacy = initialState();
  assert.equal('knowledge' in partyState(legacy), false);
  assert.equal(
    (await f.service.execute('resume_campaign', { audience: 'dm' })).knowledgeFactCount,
    0,
  );
});

test('DM resume includes a fact disclosed to a relevant character even when its subject is remote', async (t) => {
  const f = await fixture(t);
  await apply(f.service, [
    { type: 'put_entity', entity: hero },
    { type: 'put_entity', entity: { id: 'lighthouse', kind: 'location', name: 'Lighthouse' } },
    {
      type: 'set_knowledge',
      fact: {
        id: 'harbor-rumor',
        truthKind: 'claim',
        truth: 'A sailor claims the lighthouse bell rings at midnight.',
        entityIds: ['lighthouse'],
        disclosures: [
          {
            recipient: { type: 'character', id: 'hero' },
            text: 'A sailor mentioned the midnight bell.',
            kind: 'reported',
            evidence: 'The hero spoke with the sailor at the docks.',
          },
        ],
      },
    },
  ]);
  const resume = await f.service.execute('resume_campaign', { audience: 'dm' });
  assert.deepEqual(
    resume.knowledgeFacts.map((item) => item.id),
    ['harbor-rumor'],
  );
});

test('DM resume bounds knowledge facts and reports the full relevant count', async (t) => {
  const f = await fixture(t);
  const changes = Array.from({ length: 100 }, (_, index) => ({
    type: 'set_knowledge',
    fact: {
      id: `fact-${index}`,
      truthKind: 'established',
      truth: `Fact ${index}`,
    },
  }));
  await apply(f.service, changes);
  await apply(f.service, [
    { type: 'set_knowledge', fact: { id: 'fact-100', truthKind: 'plan', truth: 'Next' } },
  ]);
  const resume = await f.service.execute('resume_campaign', { audience: 'dm' });
  assert.equal(resume.knowledgeFacts.length, 100);
  assert.equal(resume.knowledgeFactIds.length, 101);
  assert.equal(resume.knowledgeFactIds.includes('fact-100'), true);
  assert.equal(resume.knowledgeFactCount, 101);
  assert.equal(resume.knowledgeFactsTruncated, true);
  assert.equal(resume.nextKnowledgeOffset, 100);
  const next = await f.service.execute('resume_campaign', {
    audience: 'dm',
    knowledgeOffset: resume.nextKnowledgeOffset,
  });
  assert.equal(next.revision, resume.revision);
  assert.equal(next.knowledgeOffset, 100);
  assert.deepEqual(
    next.knowledgeFacts.map((item) => item.id),
    ['fact-100'],
  );
  assert.equal(next.knowledgeFacts[0].truth, 'Next');
  assert.equal(next.nextKnowledgeOffset, null);
  const party = await f.service.execute('resume_campaign', {
    audience: 'party',
    knowledgeOffset: 100,
  });
  assert.equal('knowledgeFactIds' in party, false);
  assert.equal('nextKnowledgeOffset' in party, false);
});

test('partial discoveries preserve canonical claims, require evidence and invalidate pending review', async (t) => {
  const f = await fixture(t);
  await apply(f.service, [
    { type: 'put_entity', entity: hero },
    { type: 'put_entity', entity: { id: 'duke', kind: 'npc', name: 'Duke' } },
    { type: 'put_entity', entity: { id: 'lighthouse', kind: 'location', name: 'Lighthouse' } },
    { type: 'set_knowledge', fact },
  ]);
  let { revision } = await f.service.execute('campaign_status', {});
  await f.service.execute('configure_review', {
    operationId: 'review-policy',
    expectedRevision: revision,
    reason: 'Begin play',
    mode: 'reviewed',
  });
  ({ revision } = await f.service.execute('campaign_status', {}));
  await f.service.execute('prepare_action', {
    operationId: 'investigate',
    expectedRevision: revision,
    reason: 'Inspect nearby tracks',
    actionId: 'tracks',
    actors: ['hero'],
    intent: 'Inspect tracks',
    circumstances: 'On the harbor path',
  });
  const before = (await f.store.read()).state.revision;
  await assert.rejects(
    apply(f.service, [
      {
        type: 'set_knowledge',
        fact: {
          ...fact,
          disclosures: [{ ...fact.disclosures[0], evidence: '   ' }],
        },
      },
    ]),
  );
  assert.equal((await f.store.read()).state.revision, before);
  const saved = (await f.service.execute('get_campaign_knowledge', { id: fact.id })).fact;
  await apply(f.service, [
    {
      type: 'set_knowledge',
      fact: {
        ...saved,
        disclosures: [
          ...saved.disclosures,
          {
            recipient: { type: 'party' },
            kind: 'confirmed',
            text: 'The smoke comes from an occupied hearth.',
            evidence: 'The party looked through a window.',
          },
        ],
      },
    },
  ]);
  const updated = (await f.service.execute('get_campaign_knowledge', { id: fact.id })).fact;
  assert.equal(updated.truthKind, 'claim');
  assert.equal(updated.truth, fact.truth);
  assert.equal(updated.disclosures.length, 3);
  assert.deepEqual(updated.disclosures.slice(0, 2), fact.disclosures);
  const action = await f.service.execute('get_action', { actionId: 'tracks' });
  assert.equal(action.status, 'stale');
});
