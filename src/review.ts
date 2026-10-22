import { createHash } from 'node:crypto';
import { State, Payload, Change, ReviewAction } from './schema.js';
import { CampaignError, fail, rollDice } from './domain.js';

// Local canonical encoding avoids a persistence/reducer import cycle.
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.entries(value)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
      .join(',')}}`;
  return JSON.stringify(value);
}
export function gameplayFingerprint(state: State): string {
  const {
    revision: _revision,
    actions: _actions,
    reviewMode: _mode,
    table: _table,
    gathering: _gathering,
    ...gameplay
  } = state;
  return createHash('sha256').update(canonical(gameplay)).digest('hex');
}
export function actionStatus(state: State, action: ReviewAction): string {
  if (['resolved', 'cancelled', 'superseded'].includes(action.status)) return action.status;
  return action.fingerprint === gameplayFingerprint(state) ? action.status : 'stale';
}
export function mechanical(state: State, c: Change): boolean {
  switch (c.type) {
    case 'set_focus':
    case 'set_quest':
    case 'set_interaction':
    case 'define_pressure':
    case 'trigger_pressure':
    case 'set_scene':
    case 'set_session':
    case 'set_reveal':
    case 'register_art':
      return false;
    case 'put_entity': {
      const previous = state.entities[c.entity.id];
      return [previous, c.entity].some(
        (e) =>
          !!e &&
          (!!e.character || !!e.item || !!e.map || ['character', 'item', 'map'].includes(e.kind)),
      );
    }
    default:
      return true;
  }
}
export function reviewAction(state: State, id: string): ReviewAction {
  const a = state.actions?.[id];
  if (!a) throw new CampaignError('NOT_FOUND', 'Action not found');
  return a;
}
function pending(a: ReviewAction) {
  if (['resolved', 'cancelled', 'superseded'].includes(a.status)) fail('Action is closed');
}
function fresh(state: State, a: ReviewAction) {
  pending(a);
  if (actionStatus(state, a) === 'stale')
    throw new CampaignError(
      'STALE_REVIEW',
      'Gameplay changed; supersede and re-review, preserving recorded rolls.',
    );
}
export function validateReview(state: State, p: Payload): void {
  const r = p.review;
  if (!r) {
    if (p.roll?.actionId || p.roll?.stepId) fail('Action rolls require review linkage');
    if (state.reviewMode === 'reviewed' && (p.roll || p.changes.some((c) => mechanical(state, c))))
      throw new CampaignError(
        'REVIEW_REQUIRED',
        'Use an approved action or administer_campaign with an explicit reason.',
      );
    return;
  }
  if (r.type !== 'admin' && r.type !== 'commit' && p.changes.length)
    fail('Review bookkeeping cannot mutate gameplay');
  if (r.type !== 'roll' && r.type !== 'admin' && p.roll) fail('Unexpected roll');
  if (p.records.length || (p.corrects && r.type !== 'admin')) fail('Unexpected review payload');
  if (r.type === 'configure') {
    if (
      Object.values(state.actions ?? {}).some(
        (a) => !['resolved', 'cancelled', 'superseded'].includes(a.status),
      )
    )
      fail('Close pending actions before changing review mode');
    return;
  }
  if (r.type === 'prepare') {
    const a = r.action;
    if (state.actions?.[a.id]) fail('Action ID already exists');
    if (
      Object.values(state.actions ?? {}).some(
        (a) => !['resolved', 'cancelled', 'superseded'].includes(a.status),
      )
    )
      fail('Resolve or supersede the pending action first');
    if (
      a.status !== 'prepared' ||
      a.rolls.length ||
      a.ruling ||
      a.approval ||
      a.fingerprint !== gameplayFingerprint(state) ||
      a.packet.revision !== state.revision
    )
      fail('Invalid prepared action');
    return;
  }
  if (r.type === 'admin') {
    if (r.actionId) pending(reviewAction(state, r.actionId));
    return;
  }
  const a = reviewAction(state, r.actionId);
  pending(a);
  if (r.type === 'cancel') return;
  if (r.type === 'supersede') {
    if (r.packet.revision !== state.revision) fail('Replacement packet must use current revision');
    if (state.actions?.[r.replacementId]) fail('Replacement ID already exists');
    return;
  }
  fresh(state, a);
  if (r.type === 'ruling') {
    if (
      a.rolls.length &&
      (!a.ruling ||
        canonical([
          a.ruling.costs,
          a.ruling.procedure,
          a.ruling.success,
          a.ruling.failure,
          a.ruling.rolls,
        ]) !==
          canonical([
            r.ruling.costs,
            r.ruling.procedure,
            r.ruling.success,
            r.ruling.failure,
            r.ruling.rolls,
          ]))
    )
      fail('Cannot change outcome terms after rolls; use an explicit administrative override');
    if (a.status === 'approved') fail('Cannot replace an approved ruling');
    if (r.ruling.verdict === 'allowed' && r.ruling.missingFacts.length)
      fail('Resolve missing facts before allowing an action');
    if (new Set(r.ruling.rolls.map((s) => s.id)).size !== r.ruling.rolls.length)
      fail('Duplicate roll step');
    return;
  }
  if (a.status === 'prepared' || !a.ruling || a.ruling.verdict !== 'allowed')
    fail('An allowed ruling is required');
  if (r.type === 'amend') {
    if (a.status !== 'ruled') fail('Amend rolls only before approval');
    if (a.ruling.rolls.length + r.rolls.length > 30) fail('At most 30 roll steps per action');
    if (
      new Set([...a.ruling.rolls, ...r.rolls].map((s) => s.id)).size !==
      a.ruling.rolls.length + r.rolls.length
    )
      fail('Roll step already exists');
    return;
  }
  if (r.type === 'roll') {
    if (a.status !== 'ruled') fail('Roll only before approval');
    const spec = a.ruling.rolls.find((s) => s.id === r.stepId);
    if (!spec || !p.roll) fail('Unknown roll step');
    const stepIndex = a.ruling.rolls.findIndex((s) => s.id === r.stepId);
    if (
      a.ruling.rolls
        .slice(0, stepIndex)
        .some((s) => !s.optional && !a.rolls.some((roll) => roll.stepId === s.id))
    )
      fail('Resolve earlier required roll steps first');
    const minimum = rollDice(spec.expression, spec.mode, () => 0).total;
    const maximum = rollDice(spec.expression, spec.mode, (sides) => sides - 1).total;
    if (p.roll.total < minimum || p.roll.total > maximum)
      fail('Reported roll total is outside the expression bounds');
    if (a.rolls.some((roll) => roll.stepId === r.stepId))
      fail('Step already rolled; recover its saved result');
    if (
      p.roll.actionId !== a.id ||
      p.roll.stepId !== spec.id ||
      p.roll.expression !== spec.expression ||
      (p.roll.mode !== 'reported' && p.roll.mode !== spec.mode) ||
      p.roll.purpose !== spec.purpose ||
      p.roll.visibility !== spec.visibility
    )
      fail('Roll differs from recorded procedure');
    return;
  }
  if (r.type === 'approve') {
    if (a.status !== 'ruled') fail('Action must be ruled before approval');
    const skipped = r.approval.skippedRolls;
    if (new Set(skipped.map((s) => s.stepId)).size !== skipped.length)
      fail('Duplicate skipped step');
    for (const skip of skipped)
      if (
        !a.ruling.rolls.some((s) => s.id === skip.stepId && s.optional) ||
        a.rolls.some((s) => s.stepId === skip.stepId)
      )
        fail('Only unrolled optional steps can be skipped');
    for (const step of a.ruling.rolls)
      if (!a.rolls.some((s) => s.stepId === step.id) && !skipped.some((s) => s.stepId === step.id))
        fail('Resolve all roll steps before approval');
    return;
  }
  if (
    r.type === 'commit' &&
    (a.status !== 'approved' ||
      !a.approval ||
      canonical(p.changes) !== canonical(a.approval.changes))
  )
    fail('Commit must use the exact approved effects');
}
export function reduceReview(state: State, p: Payload): void {
  const r = p.review;
  if (!r) return;
  if (r.type === 'configure') {
    state.reviewMode = r.mode;
    return;
  }
  state.actions ??= {};
  if (r.type === 'prepare') {
    state.actions[r.action.id] = structuredClone(r.action);
    return;
  }
  if (r.type === 'admin') {
    if (r.actionId && !p.roll && r.closeAction) {
      const a = reviewAction(state, r.actionId);
      a.status = 'resolved';
      a.publicExplanation = r.publicExplanation;
    }
    return;
  }
  const a = reviewAction(state, r.actionId);
  switch (r.type) {
    case 'ruling':
      a.ruling = structuredClone(r.ruling);
      a.status = 'ruled';
      break;
    case 'amend':
      a.ruling!.rolls.push(...structuredClone(r.rolls));
      break;
    case 'roll':
      a.rolls.push(structuredClone(p.roll!));
      break;
    case 'approve':
      a.approval = structuredClone(r.approval);
      a.status = 'approved';
      break;
    case 'commit':
      a.status = 'resolved';
      a.publicExplanation = r.publicExplanation;
      break;
    case 'cancel':
      a.status = 'cancelled';
      break;
    case 'supersede': {
      a.status = 'superseded';
      const next = structuredClone(a);
      next.id = r.replacementId;
      next.status = 'prepared';
      next.fingerprint = gameplayFingerprint(state);
      next.packet = structuredClone(r.packet);
      // Keep the original procedure and rolls: after-roll changes require administration.
      next.approval = undefined;
      next.publicExplanation = '';
      state.actions[next.id] = next;
      // Re-link inherited results to the replacement action without rerolling.
      next.rolls = next.rolls.map((roll) => ({ ...roll, actionId: next.id }));
      break;
    }
  }
}
