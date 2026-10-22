import { randomInt } from 'node:crypto';
import { Change, Entity, Event, Payload, State, Roll } from './schema.js';
import { z } from 'zod';
import { validateReview, reduceReview } from './review.js';
import { reduceTable } from './table.js';

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
  for (const id of state.party ?? []) {
    has(id);
    if (state.entities[id].kind !== 'character') fail('Party members must be characters');
  }
  if (new Set(state.party).size !== (state.party?.length ?? 0)) fail('Duplicate party members');
  for (const id of state.focus?.activeQuestIds ?? []) {
    has(id);
    if (state.entities[id].kind !== 'quest') fail('Focus must reference quests');
  }
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
      for (const [node, location] of Object.entries(map.locations ?? {})) {
        has(location);
        if (state.entities[location].kind !== 'location') fail('Map links require locations');
        if (map.kind === 'graph' && !map.nodes.includes(node)) fail('Unknown linked node');
      }
      for (const key of Object.keys(map.layout ?? {}))
        if (!map.nodes.includes(key)) fail('Unknown layout node');
      for (const key of Object.keys(map.labels ?? {}))
        if (!map.nodes.includes(key)) fail('Unknown label node');
      for (const cell of [...(map.revealedCells ?? []), ...(map.features ?? [])])
        validateCell(map, cell);
      for (const r of map.revealedRegions ?? []) {
        validateCell(map, r);
        validateCell(map, { x: r.x + r.width - 1, y: r.y + r.height - 1 });
      }
      if (new Set(map.features?.map((f) => f.id)).size !== (map.features?.length ?? 0))
        fail('Duplicate feature');
      for (const f of map.features ?? [])
        if (f.location) {
          has(f.location);
          if (state.entities[f.location].kind !== 'location')
            fail('Feature link requires location');
        }
      if (new Set(map.nodes).size !== map.nodes.length) fail('Duplicate map nodes');
      for (const edge of map.edges)
        if (edge.some((n) => !map.nodes.includes(n))) fail('Unknown map edge node');
      for (const pair of map.revealedEdges ?? [])
        if (!map.edges.some((e) => sameEdge(e, pair))) fail('Unknown revealed edge');
      for (const [id, pos] of Object.entries(map.tokens)) {
        has(id);
        if (map.kind === 'grid' && map.bounds) validateCell(map, pos);
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
  validateReview(before, payload);
  const state = structuredClone(before);
  const entity = (id: string) => state.entities[id] ?? fail(`Unknown entity: ${id}`);
  const character = (id: string) => entity(id).character ?? fail(`No character properties: ${id}`);
  const item = (id: string) => entity(id).item ?? fail(`Not an item: ${id}`);
  for (const c of payload.changes) {
    switch (c.type) {
      case 'set_focus':
        state.focus = structuredClone(c.focus);
        break;
      case 'set_party':
        state.party = [...c.members];
        break;
      case 'set_quest':
        if (entity(c.id).kind !== 'quest') fail('Not a quest');
        entity(c.id).quest = structuredClone(c.quest);
        break;
      case 'set_interaction':
        if (entity(c.id).kind !== 'npc') fail('Not an NPC');
        entity(c.id).interaction = structuredClone(c.interaction);
        break;
      case 'define_pressure': {
        state.pressures ??= {};
        if (state.pressures[c.pressure.id])
          fail('Pressure already exists; record triggers instead');
        state.pressures[c.pressure.id] = { ...structuredClone(c.pressure), occurrences: 0 };
        break;
      }
      case 'trigger_pressure': {
        const p = state.pressures?.[c.id] ?? fail('Unknown pressure');
        if (p.trigger !== c.trigger) fail('Trigger must match the defined pressure trigger');
        p.occurrences++;
        p.lastTrigger = c.evidence;
        break;
      }
      case 'set_map':
        if (entity(c.id).kind !== 'map') fail('Not a map');
        entity(c.id).map = structuredClone(c.map);
        break;
      case 'set_positions': {
        const m = entity(c.map).map ?? fail('Not a map');
        if (new Set(c.positions.map((p) => p.entityId)).size !== c.positions.length)
          fail('Duplicate position entity');
        for (const { entityId, ...pos } of c.positions) {
          const e = entity(entityId);
          if (!['character', 'npc'].includes(e.kind)) fail('Positions require characters or NPCs');
          for (const other of Object.values(state.entities)) {
            if (other.id !== c.map && other.map && mapLevel(other.map) === mapLevel(m))
              delete other.map.tokens[entityId];
          }
          m.tokens[entityId] = pos;
        }
        break;
      }
      case 'set_reveal': {
        const m = entity(c.map).map ?? fail('Not a map');
        if (c.edges.length && m.kind !== 'graph') fail('Edge reveal requires graph');
        if (c.edges.length)
          m.revealedEdges ??= m.edges.filter((e) => e.every((n) => m.revealed.includes(n)));
        for (const edge of c.edges) {
          if (!m.edges.some((e) => sameEdge(e, edge))) fail('Unknown reveal edge');
          m.revealedEdges = m.revealedEdges!.filter((e) => !sameEdge(e, edge));
          if (c.revealed) m.revealedEdges.push(edge);
        }
        for (const n of c.nodes) {
          if (!m.nodes.includes(n)) fail('Unknown reveal node');
          m.revealed = m.revealed.filter((v) => v !== n);
          if (c.revealed) m.revealed.push(n);
        }
        if ((c.cells.length || c.regions.length) && m.kind !== 'grid')
          fail('Cell masks require grid');
        if (c.cells.length || c.regions.length) {
          // Keep masks as rectangles: concealing one cell must not expand a large map.
          let masks = [
            ...(m.revealedRegions ?? []),
            ...(m.revealedCells ?? []).map((p) => ({ ...p, width: 1, height: 1 })),
          ];
          for (const r of [...c.regions, ...c.cells.map((p) => ({ ...p, width: 1, height: 1 }))]) {
            validateCell(m, r);
            validateCell(m, { x: r.x + r.width - 1, y: r.y + r.height - 1 });
            masks = masks.flatMap((mask) => subtractRegion(mask, r));
            if (c.revealed) masks.push(r);
          }
          m.revealedCells = masks
            .filter((r) => r.width === 1 && r.height === 1)
            .map(({ x, y }) => ({ x, y }));
          m.revealedRegions = masks.filter((r) => r.width !== 1 || r.height !== 1);
        }
        for (const id of c.features) {
          const f = m.features?.find((f) => f.id === id) ?? fail('Unknown feature');
          f.revealed = c.revealed;
        }
        break;
      }
      case 'register_art': {
        const m = entity(c.map).map ?? fail('Not a map');
        if (c.art.sourceRevision > state.revision) fail('Artwork source revision is in the future');
        m.art = [...(m.art ?? []).filter((a) => a.path !== c.art.path), structuredClone(c.art)];
        break;
      }
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
  reduceReview(state, payload);
  reduceTable(state, payload);
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
type Rectangle = { x: number; y: number; width: number; height: number };
function subtractRegion(a: Rectangle, b: Rectangle): Rectangle[] {
  const left = Math.max(a.x, b.x),
    top = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.width, b.x + b.width),
    bottom = Math.min(a.y + a.height, b.y + b.height);
  if (left >= right || top >= bottom) return [a];
  return [
    { x: a.x, y: a.y, width: a.width, height: top - a.y },
    { x: a.x, y: bottom, width: a.width, height: a.y + a.height - bottom },
    { x: a.x, y: top, width: left - a.x, height: bottom - top },
    { x: right, y: top, width: a.x + a.width - right, height: bottom - top },
  ].filter((r) => r.width > 0 && r.height > 0);
}
function sameEdge(a: [string, string], b: [string, string]): boolean {
  return (a[0] === b[0] && a[1] === b[1]) || (a[0] === b[1] && a[1] === b[0]);
}
export function mapLevel(map: NonNullable<Entity['map']>): string {
  return map.level ?? (map.kind === 'grid' ? 'tactical' : 'regional');
}
export function validateCell(map: NonNullable<Entity['map']>, p: { x?: number; y?: number }): void {
  if (
    p.x === undefined ||
    p.y === undefined ||
    !Number.isSafeInteger(p.x) ||
    !Number.isSafeInteger(p.y) ||
    p.x < 0 ||
    p.y < 0 ||
    (map.bounds && (p.x >= map.bounds.width || p.y >= map.bounds.height))
  )
    fail('Cell outside map bounds or not a zero-based integer');
}
export function cellRevealed(map: NonNullable<Entity['map']>, x: number, y: number): boolean {
  return (
    !!map.revealedCells?.some((c) => c.x === x && c.y === y) ||
    !!map.revealedRegions?.some(
      (r) => x >= r.x && y >= r.y && x < r.x + r.width && y < r.y + r.height,
    )
  );
}
export function partyState(state: State): State {
  const out = structuredClone(state);
  delete out.actions;
  delete out.reviewMode;
  // Conversation is exposed explicitly by the hotseat projection, not generic party tools.
  delete out.table;
  const visible = (id: string) =>
    out.entities[id]?.visibility === 'party' && out.entities[id]?.knowledge !== 'plan';
  for (const [id, e] of Object.entries(out.entities))
    if (e.visibility !== 'party' || e.knowledge === 'plan') delete out.entities[id];
  for (const e of Object.values(out.entities)) {
    e.references = e.references.filter(visible);
    e.relationships = e.relationships.filter((r) => visible(r.target));
    if (e.item?.owner && !visible(e.item.owner)) delete e.item.owner;
    if (e.interaction) e.interaction = { ...e.interaction, knows: [], wants: [], offers: [] };
    if (e.map) {
      delete e.map.image;
      e.map.art = e.map.art?.filter((a) => a.visibility === 'party');
      for (const id of Object.keys(e.map.tokens)) if (!visible(id)) delete e.map.tokens[id];
      if (e.map.kind === 'graph') {
        const revealed = new Set(
          e.map.revealed.filter((n) => !e.map!.locations?.[n] || visible(e.map!.locations[n])),
        );
        e.map.revealed = [...revealed];
        e.map.nodes = e.map.nodes.filter((n) => revealed.has(n));
        e.map.edges = e.map.edges.filter(
          (pair) =>
            pair.every((n) => revealed.has(n)) &&
            (!e.map!.revealedEdges || e.map!.revealedEdges.some((edge) => sameEdge(edge, pair))),
        );
        if (e.map.revealedEdges) e.map.revealedEdges = e.map.edges;
        for (const [id, pos] of Object.entries(e.map.tokens))
          if (!pos.node || !revealed.has(pos.node)) delete e.map.tokens[id];
      } else {
        for (const [id, pos] of Object.entries(e.map.tokens))
          if (!cellRevealed(e.map, pos.x!, pos.y!)) delete e.map.tokens[id];
      }
      const nodes = new Set(e.map.nodes);
      for (const key of ['layout', 'locations', 'labels'] as const) {
        if (e.map[key])
          e.map[key] = Object.fromEntries(
            Object.entries(e.map[key]!).filter(([n]) => nodes.has(n)),
          ) as never;
      }
      e.map.features = e.map.features?.filter(
        (f) =>
          f.visibility === 'party' &&
          f.revealed &&
          (!f.location || visible(f.location)) &&
          cellRevealed(e.map!, f.x, f.y),
      );
    }
  }
  if (out.focus) out.focus.activeQuestIds = out.focus.activeQuestIds.filter(visible);
  if (out.party) out.party = out.party.filter(visible);
  if (out.pressures)
    out.pressures = Object.fromEntries(
      Object.entries(out.pressures).filter(([, p]) => p.visibility === 'party'),
    );
  if (out.encounter) {
    const active = out.encounter.participants[out.encounter.turn]?.id;
    out.encounter.participants = out.encounter.participants.filter((p) => visible(p.id));
    // Projection only: -1 means the active participant is not visible.
    out.encounter.turn = out.encounter.participants.findIndex((p) => p.id === active);
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
