import { node } from './dom.js';

export interface RollCardData {
  id: string;
  revision: number;
  characterName?: string;
  label: string;
  notation: string;
  mode: string;
  dice: number[];
  modifier: number;
  total: number;
  source?: string;
}

export function rollCard(roll: RollCardData) {
  const card = node('article', undefined, 'roll-card');
  const title = node('div', undefined, 'roll-card-title');
  title.append(node('strong', roll.label), node('small', `r${roll.revision}`));
  const caption = [
    roll.characterName,
    roll.notation,
    roll.mode !== 'normal' ? roll.mode : undefined,
  ]
    .filter(Boolean)
    .join(' · ');
  const modifier = roll.modifier
    ? `${roll.modifier < 0 ? '−' : '+'}${Math.abs(roll.modifier)}`
    : '0';
  const breakdown = `Faces: ${roll.dice.join(', ')} · Modifier: ${modifier} · Total: ${roll.total}`;
  card.append(
    title,
    node('div', caption, 'roll-card-caption'),
    node('div', breakdown, 'roll-card-total'),
  );
  if (roll.source === 'physical') card.append(node('small', 'Physical dice'));
  return card;
}
