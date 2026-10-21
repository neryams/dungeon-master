import { z } from 'zod';

export const Id = z
  .string()
  .min(1)
  .max(80)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/)
  .refine((v) => !['__proto__', 'constructor', 'prototype'].includes(v), 'Reserved identifier');
const Text = z.string().max(20000);
const Int = z.number().int().safe();
const Nonnegative = Int.min(0);
export const Visibility = z.enum(['party', 'dm']);
export const Resource = z.object({ current: Nonnegative, max: Nonnegative }).strict();
export const Character = z
  .object({
    abilities: z
      .record(z.enum(['str', 'dex', 'con', 'int', 'wis', 'cha']), Int.min(1).max(30))
      .default({}),
    ac: Nonnegative.default(10),
    hp: Nonnegative,
    maxHp: Int.min(1),
    tempHp: Nonnegative.default(0),
    proficiency: Nonnegative.default(2),
    saves: z.record(Id, Int).default({}),
    skills: z.record(Id, Int).default({}),
    conditions: z.array(z.object({ name: Id, duration: Text.optional() }).strict()).default([]),
    deathSaves: z
      .object({ successes: Nonnegative.max(3), failures: Nonnegative.max(3) })
      .default({ successes: 0, failures: 0 }),
    resources: z.record(Id, Resource).default({}),
  })
  .strict();
export const MapData = z
  .object({
    kind: z.enum(['grid', 'graph']),
    scale: z.string().max(100).default('5 feet'),
    nodes: z.array(Id).default([]),
    edges: z.array(z.tuple([Id, Id])).default([]),
    tokens: z
      .record(
        Id,
        z
          .object({
            x: z.number().finite().optional(),
            y: z.number().finite().optional(),
            node: Id.optional(),
          })
          .strict(),
      )
      .default({}),
    revealed: z.array(Id).default([]),
    image: z.string().max(500).optional(),
  })
  .strict();
export const Entity = z
  .object({
    id: Id,
    kind: z.enum(['character', 'npc', 'item', 'location', 'faction', 'quest', 'map']),
    name: z.string().min(1).max(200),
    visibility: Visibility.default('party'),
    description: Text.default(''),
    knowledge: z.enum(['established', 'rumor', 'plan']).default('established'),
    references: z.array(Id).default([]),
    relationships: z.array(z.object({ target: Id, description: Text }).strict()).default([]),
    status: z.string().max(200).optional(),
    character: Character.optional(),
    item: z
      .object({
        quantity: Nonnegative,
        owner: Id.optional(),
        equipped: z.boolean().default(false),
        charges: Resource.optional(),
      })
      .strict()
      .optional(),
    map: MapData.optional(),
  })
  .strict();
export type Entity = z.infer<typeof Entity>;
export const Encounter = z
  .object({
    id: Id,
    participants: z.array(z.object({ id: Id, initiative: Int }).strict()).min(1),
    round: Int.min(1).default(1),
    turn: Nonnegative.default(0),
  })
  .strict();
export const Scene = z
  .object({
    id: Id,
    title: z.string().max(200),
    location: Id.optional(),
    present: z.array(Id).default([]),
    map: Id.optional(),
    summary: Text.default(''),
    unresolved: z.array(Text).default([]),
  })
  .strict();
export const Change = z.discriminatedUnion('type', [
  z.object({ type: z.literal('put_entity'), entity: Entity }).strict(),
  z.object({ type: z.literal('damage'), id: Id, amount: Nonnegative }).strict(),
  z.object({ type: z.literal('heal'), id: Id, amount: Nonnegative }).strict(),
  z.object({ type: z.literal('set_temp_hp'), id: Id, amount: Nonnegative }).strict(),
  z
    .object({
      type: z.literal('resource'),
      id: Id,
      resource: Id,
      delta: Int,
      overrideReason: z.string().min(1).max(1000).optional(),
    })
    .strict(),
  z.object({ type: z.literal('consume_item'), id: Id, quantity: Int.min(1) }).strict(),
  z.object({ type: z.literal('transfer_item'), id: Id, owner: Id }).strict(),
  z.object({ type: z.literal('equip_item'), id: Id, equipped: z.boolean() }).strict(),
  z.object({ type: z.literal('item_charges'), id: Id, delta: Int }).strict(),
  z
    .object({
      type: z.literal('condition'),
      id: Id,
      name: Id,
      remove: z.boolean().default(false),
      duration: Text.optional(),
    })
    .strict(),
  z.object({ type: z.literal('set_encounter'), encounter: Encounter.nullable() }).strict(),
  z.object({ type: z.literal('advance_turn') }).strict(),
  z
    .object({
      type: z.literal('move_token'),
      map: Id,
      id: Id,
      x: z.number().finite().optional(),
      y: z.number().finite().optional(),
      node: Id.optional(),
    })
    .strict(),
  z.object({ type: z.literal('set_scene'), scene: Scene }).strict(),
  z.object({ type: z.literal('set_time'), time: z.string().min(1).max(200) }).strict(),
  z.object({ type: z.literal('set_session'), session: Id }).strict(),
]);
export type Change = z.infer<typeof Change>;
export const JournalRecord = z
  .object({
    id: Id,
    title: z.string().min(1).max(200),
    content: Text,
    visibility: Visibility,
    kind: z.enum(['scene', 'checkpoint']),
  })
  .strict();
export type JournalRecord = z.infer<typeof JournalRecord>;
export const Roll = z
  .object({
    id: Id,
    expression: z.string(),
    mode: z.enum(['normal', 'advantage', 'disadvantage', 'reported']),
    dice: z.array(Int),
    modifier: Int,
    total: Int,
    purpose: Text,
    visibility: Visibility,
  })
  .strict();
export const Payload = z
  .object({
    changes: z.array(Change).max(100).default([]),
    records: z.array(JournalRecord).max(10).default([]),
    roll: Roll.optional(),
    corrects: Id.optional(),
  })
  .strict();
export type Payload = z.infer<typeof Payload>;
export const Event = z
  .object({
    schemaVersion: z.literal(1),
    id: Id,
    sequence: Int.min(1),
    operationId: Id,
    requestHash: z.string(),
    timestamp: z.string().datetime(),
    actor: z.string().min(1).max(200),
    reason: Text,
    session: Id.optional(),
    scene: Id.optional(),
    payload: Payload,
  })
  .strict();
export type Event = z.infer<typeof Event>;
export const CampaignConfig = z
  .object({
    schemaVersion: z.literal(1),
    id: Id,
    name: z.string().min(1).max(200),
    edition: z.enum(['2014', '2024']).default('2024'),
    premise: Text.default(''),
    tone: Text.default('Heroic adventure'),
    houseRules: z.array(Text).default([]),
  })
  .strict();
export type CampaignConfig = z.infer<typeof CampaignConfig>;
export interface State {
  revision: number;
  entities: Record<string, Entity>;
  encounter?: z.infer<typeof Encounter>;
  scene?: z.infer<typeof Scene>;
  session?: string;
  time?: string;
}
export function initialState(): State {
  return { revision: 0, entities: {} };
}
export const Mutation = z
  .object({
    operationId: Id,
    expectedRevision: Nonnegative,
    reason: z.string().min(1).max(20000),
    actor: z.string().min(1).max(200).default('dm'),
  })
  .strict();
export type Mutation = z.infer<typeof Mutation>;
