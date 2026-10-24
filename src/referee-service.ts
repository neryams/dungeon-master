import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { CampaignStore } from './store.js';
import {
  Approval,
  Id,
  Mutation,
  ReviewMode,
  Ruling,
  RollStep,
  RefereeIdentity,
  RuleCitation,
  Change,
  ReviewPacket,
  State,
  Payload,
} from './schema.js';
import { actionStatus, gameplayFingerprint, reviewAction } from './review.js';
import { applyPayload, CampaignError, rollDice } from './domain.js';
import { ruleInputs, executeRules, validateRuleCitation } from './rules.js';
const text = z.string().trim().min(1).max(20000),
  metadata = Mutation.shape;
export const refereeInputs = {
  ...ruleInputs,
  configure_review: z.object({ ...metadata, mode: ReviewMode }).strict(),
  prepare_action: z
    .object({
      ...metadata,
      actionId: Id,
      actors: z.array(Id).min(1).max(30),
      targets: z.array(Id).max(30).default([]),
      entityIds: z.array(Id).max(100).default([]),
      intent: text,
      circumstances: text,
    })
    .strict(),
  get_action: z.object({ actionId: Id, audience: z.enum(['dm', 'party']).default('dm') }).strict(),
  record_action_ruling: z.object({ ...metadata, actionId: Id, ruling: Ruling }).strict(),
  amend_action_rolls: z
    .object({
      ...metadata,
      actionId: Id,
      rolls: z.array(RollStep).min(1).max(30),
      referee: RefereeIdentity,
      citations: z.array(RuleCitation).min(1).max(30),
    })
    .strict(),
  approve_action_effects: z.object({ ...metadata, actionId: Id, approval: Approval }).strict(),
  commit_action: z
    .object({ ...metadata, actionId: Id, publicExplanation: z.string().max(20000).default('') })
    .strict(),
  cancel_action: z.object({ ...metadata, actionId: Id }).strict(),
  supersede_action: z
    .object({
      ...metadata,
      actionId: Id,
      replacementId: Id,
      circumstances: text.optional(),
      entityIds: z.array(Id).max(100).default([]),
    })
    .strict(),
  administer_campaign: z
    .object({
      ...metadata,
      actionId: Id.optional(),
      purpose: z.enum(['override', 'delegation_unavailable', 'world_preparation', 'correction']),
      closeAction: z.boolean().default(true),
      ruling: text,
      publicExplanation: z.string().max(20000).default(''),
      changes: z.array(Change).max(100).default([]),
      eventId: Id.optional(),
      roll: z
        .object({
          expression: z.string().max(40),
          mode: z.enum(['normal', 'advantage', 'disadvantage', 'reported']).default('normal'),
          reportedTotal: z.number().int().safe().optional(),
          purpose: text,
          visibility: z.enum(['dm', 'party']).default('party'),
        })
        .strict()
        .optional(),
    })
    .strict(),
};
export const refereeDescriptions: Record<keyof typeof refereeInputs, string> = {
  configure_review:
    'Record an administrative transition to setup, reviewed play, or legacy mode. Close pending actions first.',
  prepare_action:
    'Save a pending action and return a private, revision-bound review packet. Pass the returned packet to a bounded host referee; select a supported model prioritizing speed, cost-effectiveness and rules-checking capability.',
  get_action:
    'Read a saved action, its rolls and review stage; DM view includes fresh context and stale status. Party view returns only an authored public explanation.',
  record_action_ruling:
    'Save the referee verdict, citations, costs, procedure and outcome branches before rolling. Does not itself run a model.',
  amend_action_rolls:
    'Record a referee-approved additional roll step before rolling it. Does not replace the existing outcome terms.',
  approve_action_effects:
    'Save referee approval of exact mechanical changes after checking the actual saved rolls. Does not itself run a model.',
  commit_action:
    'Atomically commit the exact approved changes at the reviewed gameplay state; no replacement effects accepted.',
  cancel_action: 'Close an action with an explicit reason, retaining rulings and rolls.',
  supersede_action:
    'Rebase stale action context under a new ID, preserving rolled results and original procedure. Requires a new ruling before approval.',
  administer_campaign:
    'Explicit administrative bypass: record reason, adjudication and purpose, then apply changes or an optional roll. Never bypasses state validation. Use for unavailable delegation, overriding rulings, corrections or world preparation.',
  list_rule_sections:
    'Browse bounded edition-specific rule headings. Omit parentId for documents, or supply a section ID for its children.',
  search_rules:
    'Search the bundled edition-specific official SRD text offline. Defaults to sections for 2024, pages for 2014. Use format=pages for the original PDF extraction.',
  read_rules:
    'Read a sectionId and optional continuation part, or up to three PDF pages using page/count. Uses campaign edition unless explicitly overridden.',
};
function packet(
  state: State,
  config: CampaignStore['config'],
  input: {
    actors: string[];
    targets: string[];
    entityIds: string[];
    intent: string;
    circumstances: string;
  },
) {
  const ids = new Set([
    ...input.actors,
    ...input.targets,
    ...input.entityIds,
    ...(state.encounter?.participants.map((p) => p.id) ?? []),
  ]);
  if (state.scene?.map) ids.add(state.scene.map);
  if (state.scene?.location) ids.add(state.scene.location);
  for (const e of Object.values(state.entities))
    if (
      (e.item?.owner && ids.has(e.item.owner)) ||
      (e.map && Object.keys(e.map.tokens).some((id) => ids.has(id)))
    )
      ids.add(e.id);
  for (const id of ids)
    if (!state.entities[id]) throw new CampaignError('NOT_FOUND', `Unknown review entity: ${id}`);
  return ReviewPacket.parse({
    revision: state.revision,
    edition: config.edition,
    houseRules: config.houseRules,
    actors: input.actors,
    targets: input.targets,
    intent: input.intent,
    circumstances: input.circumstances,
    entities: [...ids].map((id) => state.entities[id]),
    encounter: state.encounter,
    scene: state.scene,
    time: state.time,
  });
}
export async function executeReferee(
  store: CampaignStore,
  name: keyof typeof refereeInputs,
  raw: unknown,
): Promise<unknown> {
  if (name === 'search_rules' || name === 'read_rules' || name === 'list_rule_sections')
    return executeRules(name, raw, store.config.edition);
  if (name === 'get_action') {
    const i = refereeInputs[name].parse(raw),
      { state } = await store.read(),
      action = reviewAction(state, i.actionId);
    if (i.audience === 'party') {
      if (!action.publicExplanation)
        throw new CampaignError('NOT_FOUND', 'Public action explanation not found');
      return { revision: state.revision, publicExplanation: action.publicExplanation };
    }
    return {
      revision: state.revision,
      status: actionStatus(state, action),
      action,
      currentPacket: packet(state, store.config, {
        ...action.packet,
        entityIds: action.packet.entities.map((e) => e.id),
      }),
    };
  }
  const i = refereeInputs[name].parse(raw);
  const meta = Mutation.parse(
    Object.fromEntries(Object.keys(metadata).map((k) => [k, (i as Record<string, unknown>)[k]])),
  );
  const citations =
    name === 'record_action_ruling'
      ? refereeInputs.record_action_ruling.parse(raw).ruling.citations
      : name === 'approve_action_effects'
        ? refereeInputs.approve_action_effects.parse(raw).approval.citations
        : name === 'amend_action_rolls'
          ? refereeInputs.amend_action_rolls.parse(raw).citations
          : [];
  const result = await store.transact(meta, { name, input: i }, async (state) => {
    for (const citation of citations) {
      await validateRuleCitation(citation, store.config.edition);
      if (citation.source === 'house-rule' && !store.config.houseRules.includes(citation.reference))
        throw new CampaignError(
          'INVALID_CITATION',
          'House-rule citation must quote an existing configured house rule',
        );
    }
    const base: Payload = { changes: [], records: [] };
    switch (name) {
      case 'configure_review': {
        const p = refereeInputs[name].parse(i);
        return { ...base, review: { type: 'configure', mode: p.mode, reason: p.reason } };
      }
      case 'prepare_action': {
        const p = refereeInputs[name].parse(i);
        return {
          ...base,
          review: {
            type: 'prepare',
            action: {
              id: p.actionId,
              packet: packet(state, store.config, p),
              fingerprint: gameplayFingerprint(state),
              status: 'prepared',
              rolls: [],
              publicExplanation: '',
            },
          },
        };
      }
      case 'record_action_ruling': {
        const p = refereeInputs[name].parse(i);
        for (const step of p.ruling.rolls) rollDice(step.expression, step.mode, () => 0);
        return { ...base, review: { type: 'ruling', actionId: p.actionId, ruling: p.ruling } };
      }
      case 'amend_action_rolls': {
        const p = refereeInputs[name].parse(i);
        for (const step of p.rolls) rollDice(step.expression, step.mode, () => 0);
        return {
          ...base,
          review: {
            type: 'amend',
            actionId: p.actionId,
            reason: p.reason,
            rolls: p.rolls,
            referee: p.referee,
            citations: p.citations,
          },
        };
      }
      case 'approve_action_effects': {
        const p = refereeInputs[name].parse(i);
        const payload: Payload = {
          ...base,
          review: { type: 'approve', actionId: p.actionId, approval: p.approval },
        };
        const approved = applyPayload(state, payload);
        applyPayload(approved, {
          ...base,
          changes: p.approval.changes,
          review: { type: 'commit', actionId: p.actionId, publicExplanation: '' },
        });
        return payload;
      }
      case 'commit_action': {
        const p = refereeInputs[name].parse(i);
        return {
          ...base,
          changes: reviewAction(state, p.actionId).approval?.changes ?? [],
          review: { type: 'commit', actionId: p.actionId, publicExplanation: p.publicExplanation },
        };
      }
      case 'cancel_action': {
        const p = refereeInputs[name].parse(i);
        return { ...base, review: { type: 'cancel', actionId: p.actionId, reason: p.reason } };
      }
      case 'supersede_action': {
        const p = refereeInputs[name].parse(i);
        const prior = reviewAction(state, p.actionId).packet;
        return {
          ...base,
          review: {
            type: 'supersede',
            actionId: p.actionId,
            replacementId: p.replacementId,
            packet: packet(state, store.config, {
              ...prior,
              circumstances: p.circumstances ?? prior.circumstances,
              entityIds: [...prior.entities.map((e) => e.id), ...p.entityIds],
            }),
            reason: p.reason,
          },
        };
      }
      case 'administer_campaign': {
        const p = refereeInputs[name].parse(i);
        if (p.roll && p.changes.length)
          throw new CampaignError(
            'INVALID_CHANGE',
            'Record administrative dice before supplying dependent effects',
          );
        if (p.roll?.mode === 'reported' && p.roll.reportedTotal === undefined)
          throw new CampaignError('INVALID_ROLL', 'Reported total required');
        if (p.roll && p.roll.mode !== 'reported' && p.roll.reportedTotal !== undefined)
          throw new CampaignError('INVALID_ROLL', 'Reported total only applies to reported dice');
        return {
          ...base,
          changes: p.changes,
          corrects: p.eventId,
          review: {
            type: 'admin',
            actionId: p.actionId,
            purpose: p.purpose,
            closeAction: p.closeAction,
            reason: p.reason,
            ruling: p.ruling,
            publicExplanation: p.publicExplanation,
          },
          ...(p.roll
            ? {
                roll: {
                  id: randomUUID(),
                  expression: p.roll.expression,
                  mode: p.roll.mode,
                  purpose: p.roll.purpose,
                  visibility: p.roll.visibility,
                  ...(p.roll.mode === 'reported'
                    ? { dice: [], modifier: 0, total: p.roll.reportedTotal! }
                    : rollDice(p.roll.expression, p.roll.mode)),
                },
              }
            : {}),
        };
      }
    }
    throw new Error('Unknown referee operation');
  });
  return {
    revision: result.state.revision,
    event: result.event,
    duplicate: result.duplicate,
    warnings: result.warnings,
  };
}
