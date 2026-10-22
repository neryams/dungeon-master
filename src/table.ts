import { Payload, State } from './schema.js';
import { fail } from './domain.js';

export function reduceTable(state: State, payload: Payload): void {
  const op = payload.table;
  if (!op) {
    if (
      state.gathering &&
      (payload.changes.length || payload.roll || payload.review || payload.corrects)
    ) {
      state.gathering.epoch++;
      for (const a of Object.values(state.gathering.actions)) a.confirmed = false;
    }
    return;
  }
  if (
    payload.changes.length ||
    payload.records.length ||
    payload.review ||
    payload.roll ||
    payload.corrects
  )
    fail('Table messages cannot carry gameplay changes or private records');
  const turns = (state.table ??= []);
  const visible = (id: string) => {
    const c = state.entities[id];
    if (
      !c?.character ||
      c.visibility !== 'party' ||
      c.knowledge === 'plan' ||
      (state.party && !state.party.includes(id))
    )
      fail('Choose a visible party character');
  };
  if (op.type === 'seats' || op.type === 'intent' || op.type === 'reset_intents') {
    const g = (state.gathering ??= { epoch: 0, seats: [], actions: {} });
    if (op.type === 'seats') {
      op.characterIds.forEach(visible);
      g.seats = [...new Set(op.characterIds)];
    } else if (op.type === 'intent') {
      visible(op.action.characterId);
      if (g.epoch !== op.epoch) fail('Situation changed. Refresh and confirm again');
      if (
        !g.seats.includes(op.action.characterId) &&
        !g.request?.characterIds.includes(op.action.characterId) &&
        state.encounter?.participants[state.encounter.turn]?.id !== op.action.characterId
      )
        fail('Character has no active seat');
      if (g.request && !g.request.characterIds.includes(op.action.characterId))
        fail('Waiting for requested characters');
      if (op.action.confirmed && turns.some((t) => t.status === 'pending'))
        fail('Wait for the DM before confirming');
      if (op.action.confirmed && !op.action.pass && !op.action.text.trim())
        fail('Enter an intention or pass');
      g.actions[op.action.characterId] = op.action;
    } else if (op.type === 'reset_intents') {
      g.epoch++;
      for (const a of Object.values(g.actions)) a.confirmed = false;
    }
    return;
  }
  if (op.type === 'submit') {
    if (turns.some((t) => t.id === op.id)) fail('Table request already exists');
    if (turns.some((t) => t.status === 'pending')) fail('Finish the current table request first');
    const character = op.characterId ? state.entities[op.characterId] : undefined;
    if (
      op.characterId &&
      (!character?.character ||
        character.visibility !== 'party' ||
        character.knowledge === 'plan' ||
        (state.party && !state.party.includes(op.characterId)))
    )
      fail('Choose a visible party character');
    if (op.actions) {
      op.actions.forEach((a) => visible(a.characterId));
      if (!state.gathering || op.groupEpoch !== state.gathering.epoch)
        fail('Group changed; reconfirm intentions');
      for (const a of op.actions) {
        if (
          !a.confirmed ||
          JSON.stringify(a) !== JSON.stringify(state.gathering.actions[a.characterId])
        )
          fail('Intention changed');
        if (
          state.gathering.request &&
          !state.gathering.request.characterIds.includes(a.characterId)
        )
          fail('Not a requested character');
        if (
          !state.gathering.request &&
          state.encounter &&
          state.encounter.participants[state.encounter.turn]?.id !== a.characterId
        )
          fail('Wait for initiative');
      }
    }
    if (state.gathering) {
      state.gathering.epoch++;
      for (const a of op.actions ?? []) delete state.gathering.actions[a.characterId];
      for (const a of Object.values(state.gathering.actions)) a.confirmed = false;
      delete state.gathering.request;
    }
    turns.push({
      id: op.id,
      characterId: op.characterId,
      actions: op.actions,
      speaker: character?.name ?? 'Table',
      text: op.text,
      revision: state.revision + 1,
      status: 'pending',
      messages: [],
    });
    return;
  }
  const turn = turns.find((t) => t.id === op.requestId);
  if (!turn || turn.status !== 'pending') fail('Table request is not pending');
  if (op.type === 'publish') {
    if (turn.messages.length >= 30) fail('Too many messages in one table turn');
    if (op.responseRequest) {
      op.responseRequest.characterIds.forEach(visible);
      turn.responseRequest = op.responseRequest;
    }
    turn.messages.push({ text: op.text, revision: state.revision + 1 });
  } else {
    if (op.status === 'completed' && !turn.messages.length)
      fail('Publish a public response before completing a turn');
    turn.status = op.status;
    if (state.gathering || turn.responseRequest) {
      const g = (state.gathering ??= { epoch: 0, seats: [], actions: {} });
      g.epoch++;
      for (const a of Object.values(g.actions)) a.confirmed = false;
      g.request = turn.responseRequest;
    }
  }
}
