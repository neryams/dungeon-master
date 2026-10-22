import { Payload, State } from './schema.js';
import { fail } from './domain.js';

export function reduceTable(state: State, payload: Payload): void {
  const op = payload.table;
  if (!op) return;
  if (
    payload.changes.length ||
    payload.records.length ||
    payload.review ||
    payload.roll ||
    payload.corrects
  )
    fail('Table messages cannot carry gameplay changes or private records');
  const turns = (state.table ??= []);
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
    turns.push({
      id: op.id,
      characterId: op.characterId,
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
    turn.messages.push({ text: op.text, revision: state.revision + 1 });
  } else {
    if (op.status === 'completed' && !turn.messages.length)
      fail('Publish a public response before completing a turn');
    turn.status = op.status;
  }
}
