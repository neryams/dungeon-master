import { randomInt } from 'node:crypto';
import { Change, Entity, Event, Payload, State, Roll } from './schema.js';
import { z } from 'zod';

export class CampaignError extends Error {
  constructor(
    public code: string,
    message: string,
    public details: unknown = undefined,
  ) {
    super(message);
  }
}
export function fail(message: string): never {
  throw new CampaignError('INVALID_CHANGE', message);
}
export function validateState(state: State): void {
  const has = (id: string) => {
    if (!state.entities[id]) fail(`Unknown entity: ${id}`);
  };
  for (const entity of Object.values(state.entities)) {
    Entity.parse(entity);
    entity.references.forEach(has);
    entity.relationships.forEach((r) => has(r.target));
    if (entity.kind === 'character' && !entity.character)
      fail(`Character data missing: ${entity.id}`);
    if (entity.kind === 'item' && !entity.item) fail(`Item data missing: ${entity.id}`);
    if (entity.kind === 'map' && !entity.map) fail(`Map data missing: ${entity.id}`);
    if (entity.character) {
      if (entity.character.hp > entity.character.maxHp) fail('HP exceeds maximum');
      for (const resource of Object.values(entity.character.resources))
        if (resource.current > resource.max) fail('Resource exceeds maximum');
    }
    if (entity.item?.owner) {
      has(entity.item.owner);
      if (!state.entities[entity.item.owner].character) fail('Item owner must have character data');
    }
    if (entity.item?.charges && entity.item.charges.current > entity.item.charges.max)
      fail('Charges exceed maximum');
    if (entity.map) {
      const map = entity.map;
      if (new Set(map.nodes).size !== map.nodes.length) fail('Duplicate map nodes');
      for (const edge of map.edges)
        if (edge.some((n) => !map.nodes.includes(n))) fail('Unknown map edge node');
      for (const [id, pos] of Object.entries(map.tokens)) {
        has(id);
        if (
          map.kind === 'grid' &&
          (pos.x === undefined || pos.y === undefined || pos.node !== undefined)
        )
          fail('Grid positions require x/y only');
        if (
          map.kind === 'graph' &&
          (!pos.node || !map.nodes.includes(pos.node) || pos.x !== undefined || pos.y !== undefined)
        )
          fail('Graph positions require an existing node only');
      }
      if (map.kind === 'graph' && map.revealed.some((n) => !map.nodes.includes(n)))
        fail('Unknown revealed node');
      if (
        map.image &&
        (map.image.startsWith('/') ||
          map.image.includes('..') ||
          map.image.includes('\\') ||
          /^[a-z]+:/i.test(map.image))
      )
        fail('Map image must be campaign-relative');
    }
  }
  if (state.encounter) {
    const e = state.encounter;
    e.participants.forEach((p) => has(p.id));
    if (
      new Set(e.participants.map((p) => p.id)).size !== e.participants.length ||
      e.turn >= e.participants.length
    )
      fail('Invalid encounter order or turn');
  }
  if (state.scene) {
    state.scene.present.forEach(has);
    if (state.scene.location) {
      has(state.scene.location);
      if (state.entities[state.scene.location].kind !== 'location')
        fail('Scene location must be a location');
    }
    if (state.scene.map) {
      has(state.scene.map);
      if (!state.entities[state.scene.map].map) fail('Scene map must be a map');
    }
  }
}
export function applyPayload(before: State, payload: Payload): State {
  const state = structuredClone(before);
  const entity = (id: string) => state.entities[id] ?? fail(`Unknown entity: ${id}`);
  const character = (id: string) => entity(id).character ?? fail(`No character properties: ${id}`);
  const item = (id: string) => entity(id).item ?? fail(`Not an item: ${id}`);
  for (const c of payload.changes) {
    switch (c.type) {
      case 'put_entity':
        state.entities[c.entity.id] = structuredClone(c.entity);
        break;
      case 'damage': {
        const p = character(c.id);
        const absorbed = Math.min(p.tempHp, c.amount);
        p.tempHp -= absorbed;
        p.hp = Math.max(0, p.hp - (c.amount - absorbed));
        break;
      }
      case 'heal': {
        const p = character(c.id);
        p.hp = Math.min(p.maxHp, p.hp + c.amount);
        break;
      }
      case 'set_temp_hp':
        character(c.id).tempHp = c.amount;
        break;
      case 'resource': {
        const r = character(c.id).resources[c.resource] ?? fail('Unknown resource');
        const next = r.current + c.delta;
        if (next < 0) fail('Resource cannot be negative');
        if (next > r.max) {
          if (!c.overrideReason)
            fail('Resource exceeds maximum; explicit override reason required');
          r.max = next;
        }
        r.current = next;
        break;
      }
      case 'consume_item': {
        const i = item(c.id);
        if (i.quantity < c.quantity) fail('Insufficient item quantity');
        i.quantity -= c.quantity;
        if (i.quantity === 0) i.equipped = false;
        break;
      }
      case 'transfer_item':
        item(c.id).owner = c.owner;
        break;
      case 'equip_item': {
        const i = item(c.id);
        if (c.equipped && i.quantity === 0) fail('Cannot equip an empty stack');
        i.equipped = c.equipped;
        break;
      }
      case 'item_charges': {
        const r = item(c.id).charges ?? fail('Item has no charges');
        r.current += c.delta;
        break;
      }
      case 'condition': {
        const p = character(c.id);
        p.conditions = p.conditions.filter((v) => v.name !== c.name);
        if (!c.remove)
          p.conditions.push({ name: c.name, ...(c.duration ? { duration: c.duration } : {}) });
        break;
      }
      case 'set_encounter':
        state.encounter = c.encounter ? structuredClone(c.encounter) : undefined;
        break;
      case 'advance_turn': {
        const e = state.encounter ?? fail('No active encounter');
        e.turn++;
        if (e.turn === e.participants.length) {
          e.turn = 0;
          e.round++;
        }
        break;
      }
      case 'move_token': {
        const m = entity(c.map).map ?? fail('Not a map');
        if (
          (m.kind === 'grid' && (c.x === undefined || c.y === undefined || c.node !== undefined)) ||
          (m.kind === 'graph' && (!c.node || c.x !== undefined || c.y !== undefined))
        )
          fail('Position does not match map type');
        m.tokens[c.id] = m.kind === 'grid' ? { x: c.x, y: c.y } : { node: c.node };
        break;
      }
      case 'set_scene':
        state.scene = structuredClone(c.scene);
        break;
      case 'set_time':
        state.time = c.time;
        break;
      case 'set_session':
        state.session = c.session;
        break;
      default: {
        const exhaustive: never = c;
        throw new Error(String(exhaustive));
      }
    }
  }
  validateState(state);
  return state;
}
export function replay(events: Event[]): State {
  let state: State = { revision: 0, entities: {} };
  for (const event of events) {
    state = applyPayload(state, event.payload);
    state.revision = event.sequence;
  }
  return state;
}
export function rollDice(
  expression: string,
  mode: 'normal' | 'advantage' | 'disadvantage',
  rng: (max: number) => number = randomInt,
): Pick<z.infer<typeof Roll>, 'dice' | 'modifier' | 'total'> {
  const match = /^(\d{1,3})d(\d{1,5})([+-]\d{1,6})?$/.exec(expression);
  if (!match) fail('Use NdM, NdM+K or NdM-K');
  const count = Number(match[1]),
    sides = Number(match[2]),
    modifier = Number(match[3] ?? 0);
  if (count < 1 || count > 100 || sides < 2 || sides > 10000)
    fail('Dice bounds: 1–100 dice, 2–10000 sides');
  if (mode !== 'normal' && (count !== 1 || sides !== 20))
    fail('Advantage/disadvantage requires 1d20');
  const dice = Array.from({ length: mode === 'normal' ? count : 2 }, () => rng(sides) + 1);
  const base =
    mode === 'advantage'
      ? Math.max(...dice)
      : mode === 'disadvantage'
        ? Math.min(...dice)
        : dice.reduce((a, b) => a + b, 0);
  return { dice, modifier, total: base + modifier };
}
export function partyState(state: State): State {
  const out = structuredClone(state);
  const visible = (id: string) =>
    out.entities[id]?.visibility === 'party' && out.entities[id]?.knowledge !== 'plan';
  for (const [id, e] of Object.entries(out.entities))
    if (e.visibility !== 'party' || e.knowledge === 'plan') delete out.entities[id];
  for (const e of Object.values(out.entities)) {
    e.references = e.references.filter(visible);
    e.relationships = e.relationships.filter((r) => visible(r.target));
    if (e.item?.owner && !visible(e.item.owner)) delete e.item.owner;
    if (e.map) {
      for (const id of Object.keys(e.map.tokens)) if (!visible(id)) delete e.map.tokens[id];
      if (e.map.kind === 'graph') {
        const revealed = new Set(e.map.revealed);
        e.map.nodes = e.map.nodes.filter((n) => revealed.has(n));
        e.map.edges = e.map.edges.filter((pair) => pair.every((n) => revealed.has(n)));
        for (const [id, pos] of Object.entries(e.map.tokens))
          if (!pos.node || !revealed.has(pos.node)) delete e.map.tokens[id];
      }
    }
  }
  if (out.encounter) {
    const active = out.encounter.participants[out.encounter.turn]?.id;
    out.encounter.participants = out.encounter.participants.filter((p) => visible(p.id));
    out.encounter.turn = Math.max(
      0,
      out.encounter.participants.findIndex((p) => p.id === active),
    );
    if (!out.encounter.participants.length) delete out.encounter;
  }
  if (out.scene) {
    out.scene.present = out.scene.present.filter(visible);
    if (out.scene.location && !visible(out.scene.location)) delete out.scene.location;
    if (out.scene.map && !visible(out.scene.map)) delete out.scene.map;
  }
  return out;
}
export function changesInput(changes: unknown): Change[] {
  return Change.array().min(1).max(100).parse(changes);
}
