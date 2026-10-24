import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { CampaignStore, stableJson } from '../store.js';
import { CampaignError, rollDice, applyPayload, partyState, isPlayerCharacter } from '../domain.js';
import { inputs } from '../service.js';
import { refereeInputs } from '../referee-service.js';
import type { Event, PendingRoll, State } from '../schema.js';
import { validateReview } from '../review.js';
import { safeLabel } from './activity.js';

export const SubmitRollInput = z
  .object({
    id: z.string().uuid(),
    dice: z.array(z.number().int().safe()).min(1).max(100).optional(),
  })
  .strict();
export type SubmitRollInput = z.infer<typeof SubmitRollInput>;

export function rollTarget(state: State, raw: unknown): string | undefined {
  const input = inputs.roll_dice.parse(raw);
  if (input.visibility !== 'party' || input.mode === 'reported') return undefined;
  const actor =
    input.characterId ??
    (input.actionId && state.actions?.[input.actionId]?.packet.actors.length === 1
      ? state.actions[input.actionId].packet.actors[0]
      : undefined);
  return actor && isPlayerCharacter(state, actor) ? actor : undefined;
}

function fingerprint(input: unknown): string {
  return createHash('sha256').update(stableJson(input)).digest('hex');
}

export async function requestPlayerRoll(
  store: CampaignStore,
  raw: unknown,
): Promise<PendingRoll | undefined> {
  const input = inputs.roll_dice.parse(raw);
  const { state, events } = await store.read();
  const prior = events.find((e) => e.operationId === input.operationId);
  if (prior) {
    if (prior.requestHash !== fingerprint({ name: 'roll_dice', input }))
      throw new CampaignError(
        'OPERATION_REUSED',
        'Operation ID was already used with different input',
      );
    return prior.payload.rollRequest;
  }
  if (input.mode === 'reported') {
    if (input.characterId && !isPlayerCharacter(state, input.characterId))
      throw new CampaignError('INVALID_ROLL', 'characterId must name a party character');
    const actor =
      input.characterId ??
      (input.actionId && state.actions?.[input.actionId]?.packet.actors.length === 1
        ? state.actions[input.actionId].packet.actors[0]
        : undefined);
    if (input.visibility === 'party' && actor && isPlayerCharacter(state, actor))
      throw new CampaignError(
        'INVALID_ROLL',
        'Player physical dice require raw faces through the table',
      );
    return undefined;
  }
  const mode = input.mode;
  if (input.characterId && !isPlayerCharacter(state, input.characterId))
    throw new CampaignError('INVALID_ROLL', 'characterId must name a party character');
  const target = rollTarget(state, input);
  if (!target) return undefined;
  const result = await store.transact(
    {
      operationId: input.operationId,
      expectedRevision: input.expectedRevision,
      reason: input.reason,
      actor: input.actor,
    },
    { name: 'roll_dice', input },
    (current) => {
      const characterId = rollTarget(current, input);
      if (!characterId || characterId !== target)
        throw new CampaignError('REVISION_CONFLICT', 'Player roll target changed');
      if (input.actionId || input.stepId) {
        const action = input.actionId ? current.actions?.[input.actionId] : undefined;
        const spec = action?.ruling?.rolls.find((s) => s.id === input.stepId);
        if (
          !action ||
          action.status !== 'ruled' ||
          !spec ||
          spec.expression !== input.expression ||
          spec.mode !== input.mode ||
          spec.purpose !== input.purpose ||
          action.rolls.some((r) => r.stepId === input.stepId)
        )
          throw new CampaignError('INVALID_ROLL', 'Roll differs from the reviewed player action');
        if (
          Object.values(current.pendingRolls ?? {}).some(
            (r) => r.actionId === input.actionId && r.stepId === input.stepId,
          )
        )
          throw new CampaignError('INVALID_ROLL', 'This action roll is already awaiting a player');
      }
      const proposed = {
        changes: [],
        records: [],
        ...(input.actionId && input.stepId
          ? { review: { type: 'roll' as const, actionId: input.actionId, stepId: input.stepId } }
          : {}),
        roll: {
          id: randomUUID(),
          characterId,
          expression: input.expression,
          mode,
          purpose: input.purpose,
          visibility: 'party' as const,
          ...(input.actionId ? { actionId: input.actionId } : {}),
          ...(input.stepId ? { stepId: input.stepId } : {}),
          ...rollDice(input.expression, mode, () => 0),
        },
      };
      validateReview(current, proposed);
      applyPayload(current, proposed);
      const tableRequestId = [...(current.table ?? [])]
        .reverse()
        .find((t) => t.status === 'pending')?.id;
      return {
        changes: [],
        records: [],
        rollRequest: {
          id: randomUUID(),
          operationId: input.operationId,
          characterId,
          ...(tableRequestId ? { tableRequestId } : {}),
          expression: input.expression,
          mode,
          purpose: input.purpose,
          ...(input.actionId ? { actionId: input.actionId } : {}),
          ...(input.stepId ? { stepId: input.stepId } : {}),
        },
      };
    },
  );
  return result.event.payload.rollRequest;
}

export async function requestAdministrativePlayerRoll(
  store: CampaignStore,
  raw: unknown,
): Promise<PendingRoll | undefined> {
  const input = refereeInputs.administer_campaign.parse(raw);
  const { state, events } = await store.read();
  const prior = events.find((e) => e.operationId === input.operationId);
  if (prior) {
    if (prior.requestHash !== fingerprint({ name: 'administer_campaign', input }))
      throw new CampaignError(
        'OPERATION_REUSED',
        'Operation ID was already used with different input',
      );
    return prior.payload.rollRequest;
  }
  if (!input.roll || input.roll.visibility !== 'party') return undefined;
  if (input.roll.characterId && !isPlayerCharacter(state, input.roll.characterId))
    throw new CampaignError('INVALID_ROLL', 'characterId must name a party character');
  const characterId =
    input.roll.characterId ??
    (input.actionId && state.actions?.[input.actionId]?.packet.actors.length === 1
      ? state.actions[input.actionId].packet.actors[0]
      : undefined);
  if (!characterId || !isPlayerCharacter(state, characterId)) return undefined;
  if (input.roll.mode === 'reported')
    throw new CampaignError(
      'INVALID_ROLL',
      'Player physical dice require raw faces through the table',
    );
  if (input.changes.length)
    throw new CampaignError(
      'INVALID_CHANGE',
      'Record administrative dice before dependent effects',
    );
  const mode = input.roll.mode;
  const result = await store.transact(
    {
      operationId: input.operationId,
      expectedRevision: input.expectedRevision,
      reason: input.reason,
      actor: input.actor,
    },
    { name: 'administer_campaign', input },
    (current) => {
      if (!isPlayerCharacter(current, characterId))
        throw new CampaignError('REVISION_CONFLICT', 'Player roll target changed');
      const admin = {
        actionId: input.actionId,
        purpose: input.purpose,
        closeAction: input.closeAction,
        reason: input.reason,
        ruling: input.ruling,
        publicExplanation: input.publicExplanation,
        eventId: input.eventId,
      };
      const proposed = {
        changes: [],
        records: [],
        corrects: input.eventId,
        review: {
          type: 'admin' as const,
          actionId: input.actionId,
          purpose: input.purpose,
          closeAction: input.closeAction,
          reason: input.reason,
          ruling: input.ruling,
          publicExplanation: input.publicExplanation,
        },
        roll: {
          id: randomUUID(),
          characterId,
          expression: input.roll!.expression,
          mode,
          purpose: input.roll!.purpose,
          visibility: 'party' as const,
          ...rollDice(input.roll!.expression, mode, () => 0),
        },
      };
      applyPayload(current, proposed);
      const tableRequestId = [...(current.table ?? [])]
        .reverse()
        .find((t) => t.status === 'pending')?.id;
      return {
        changes: [],
        records: [],
        rollRequest: {
          id: randomUUID(),
          operationId: input.operationId,
          characterId,
          ...(tableRequestId ? { tableRequestId } : {}),
          expression: input.roll!.expression,
          mode,
          purpose: input.roll!.purpose,
          admin,
        },
      };
    },
  );
  return result.event.payload.rollRequest;
}

export async function submitPlayerRoll(store: CampaignStore, raw: unknown, characterId?: string) {
  const input = SubmitRollInput.parse(raw);
  for (let attempt = 0; attempt < 5; attempt++) {
    const { state, events } = await store.read();
    const completed = events.find((e) => e.payload.completesRoll === input.id);
    if (completed) {
      if (characterId && completed.payload.roll?.characterId !== characterId)
        throw new CampaignError('FORBIDDEN', 'Roll belongs to another character');
      if (
        completed.requestHash !==
        fingerprint({ name: 'submit_player_roll', id: input.id, dice: input.dice ?? null })
      )
        throw new CampaignError(
          'OPERATION_REUSED',
          'Roll request was already completed with different dice',
        );
      return { id: input.id, duplicate: true, roll: completed.payload.roll };
    }
    const request = state.pendingRolls?.[input.id];
    if (!request) throw new CampaignError('NOT_FOUND', 'Pending roll not found');
    if (characterId && request.characterId !== characterId)
      throw new CampaignError('FORBIDDEN', 'Roll belongs to another character');
    const minimum = rollDice(request.expression, request.mode, () => 0);
    const dieCount = minimum.dice.length;
    const sides = Number(/^\d+d(\d+)/.exec(request.expression)![1]);
    if (
      input.dice &&
      (input.dice.length !== dieCount || input.dice.some((d) => d < 1 || d > sides))
    )
      throw new CampaignError('INVALID_ROLL', `Enter ${dieCount} raw d${sides} faces`);
    let index = 0;
    const values = input.dice
      ? rollDice(request.expression, request.mode, () => input.dice![index++] - 1)
      : rollDice(request.expression, request.mode);
    try {
      const result = await store.transact(
        {
          operationId: request.id,
          expectedRevision: state.revision,
          reason: `Complete player roll: ${request.purpose}`,
          actor: request.characterId,
        },
        { name: 'submit_player_roll', id: request.id, dice: input.dice ?? null },
        () => ({
          changes: [],
          records: [],
          completesRoll: request.id,
          ...(request.admin
            ? {
                review: {
                  type: 'admin' as const,
                  actionId: request.admin.actionId,
                  purpose: request.admin.purpose,
                  closeAction: request.admin.closeAction,
                  reason: request.admin.reason,
                  ruling: request.admin.ruling,
                  publicExplanation: request.admin.publicExplanation,
                },
                ...(request.admin.eventId ? { corrects: request.admin.eventId } : {}),
              }
            : request.actionId && request.stepId
              ? {
                  review: {
                    type: 'roll' as const,
                    actionId: request.actionId,
                    stepId: request.stepId,
                  },
                }
              : {}),
          roll: {
            id: randomUUID(),
            characterId: request.characterId,
            source: input.dice ? ('physical' as const) : ('digital' as const),
            expression: request.expression,
            mode: request.mode,
            purpose: request.purpose,
            visibility: 'party' as const,
            ...values,
            ...(request.actionId ? { actionId: request.actionId } : {}),
            ...(request.stepId ? { stepId: request.stepId } : {}),
          },
        }),
      );
      return { id: input.id, duplicate: result.duplicate, roll: result.event.payload.roll };
    } catch (error) {
      if (error instanceof CampaignError && error.code === 'REVISION_CONFLICT') continue;
      throw error;
    }
  }
  throw new CampaignError('REVISION_CONFLICT', 'Roll could not be saved; refresh and retry');
}

export function playerRollView(state: State, events: Event[]) {
  const visible = partyState(state);
  const pendingRolls = Object.values(state.pendingRolls ?? {}).map((request) => {
    const match = /^(\d+)d(\d+)/.exec(request.expression)!;
    return {
      id: request.id,
      characterId: request.characterId,
      characterName: visible.entities[request.characterId]?.name ?? 'Character',
      label: safeLabel(request.purpose),
      notation: request.expression,
      mode: request.mode,
      dieCount: request.mode === 'normal' ? Number(match[1]) : 2,
      dieSides: Number(match[2]),
    };
  });
  const rollHistory = events
    .filter((e) => e.payload.roll?.visibility === 'party')
    .map((e) => {
      const roll = e.payload.roll!;
      const notation = /^\d{1,3}d\d{1,5}(?:[+-]\d{1,6})?$/.test(roll.expression)
        ? roll.expression
        : 'Reported roll';
      return {
        id: roll.id,
        revision: e.sequence,
        characterId: roll.characterId,
        characterName: roll.characterId ? visible.entities[roll.characterId]?.name : undefined,
        label: safeLabel(roll.purpose),
        notation,
        mode: roll.mode,
        dice: roll.dice,
        modifier: roll.modifier,
        total: roll.total,
        source: roll.source ?? (roll.mode === 'reported' ? 'physical' : 'digital'),
      };
    });
  return { pendingRolls, rollHistory };
}
