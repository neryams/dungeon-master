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
// Homogeneous fixed-length arrays work in both draft-07 and 2020-12 JSON Schema.
// Zod tuples emit draft-07 array-valued `items`, rejected by stricter MCP hosts.
export const MapEdge = z
  .array(Id)
  .length(2)
  .transform((edge): [string, string] => [edge[0], edge[1]]);
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
export const QuestProgress = z
  .object({
    objective: Text,
    stakes: Text,
    progress: z.array(Text).default([]),
    leads: z.array(Text).default([]),
    completionConditions: z.array(Text).default([]),
    status: z.enum(['active', 'resolved', 'dormant', 'abandoned']).default('active'),
  })
  .strict();
export const Interaction = z
  .object({
    wants: z.array(Text).default([]),
    knows: z.array(Text).default([]),
    disclosed: z.array(Text).default([]),
    offers: z.array(Text).default([]),
    unresolvedTopics: z.array(Text).default([]),
    resolvedTopics: z.array(Text).default([]),
    status: z.enum(['open', 'served']).default('open'),
  })
  .strict();
export const Focus = z.object({ primaryObjective: Text, activeQuestIds: z.array(Id) }).strict();
export const Pressure = z
  .object({
    id: Id,
    name: Text,
    trigger: z.string().min(1).max(20000),
    consequence: Text,
    visibility: Visibility.default('dm'),
    occurrences: Nonnegative.default(0),
    lastTrigger: Text.optional(),
  })
  .strict();
export const Position = z
  .object({
    x: z.number().finite().optional(),
    y: z.number().finite().optional(),
    node: Id.optional(),
  })
  .strict();
export const Cell = z.object({ x: Nonnegative, y: Nonnegative }).strict();
export const Region = z
  .object({
    x: Nonnegative,
    y: Nonnegative,
    width: Int.min(1).max(1000),
    height: Int.min(1).max(1000),
  })
  .strict();
export const Viewport = z
  .object({ x: Int, y: Int, width: Int.min(1).max(40), height: Int.min(1).max(40) })
  .strict();
export const MapArt = z
  .object({
    path: z
      .string()
      .regex(/^assets\/[a-zA-Z0-9_./-]+$/)
      .refine((p) => !p.split('/').includes('..')),
    purpose: Text,
    sourceRevision: Nonnegative,
    visibility: Visibility,
  })
  .strict();
export const MapData = z
  .object({
    kind: z.enum(['grid', 'graph']),
    level: z.enum(['regional', 'tactical']).optional(),
    bounds: z
      .object({ width: Int.min(1).max(1000), height: Int.min(1).max(1000) })
      .strict()
      .optional(),
    origin: z.literal('upper-left').optional(),
    layout: z.record(Id, Cell).optional(),
    locations: z.record(Id, Id).optional(),
    labels: z.record(Id, Text).optional(),
    features: z
      .array(
        z
          .object({
            id: Id,
            x: Nonnegative,
            y: Nonnegative,
            label: Text,
            kind: z.enum(['terrain', 'obstacle', 'landmark']),
            visibility: Visibility,
            revealed: z.boolean(),
            location: Id.optional(),
          })
          .strict(),
      )
      .optional(),
    revealedCells: z.array(Cell).max(10000).optional(),
    revealedRegions: z.array(Region).max(1000).optional(),
    art: z.array(MapArt).optional(),
    scale: z.string().max(100).default('5 feet'),
    nodes: z.array(Id).default([]),
    edges: z.array(MapEdge).default([]),
    revealedEdges: z.array(MapEdge).optional(),
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
    quest: QuestProgress.optional(),
    interaction: Interaction.optional(),
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
    centralQuestion: Text.optional(),
    progress: z.array(Text).optional(),
    pendingDecision: Text.optional(),
    exitConditions: z.array(Text).optional(),
  })
  .strict();
export const Change = z.discriminatedUnion('type', [
  z.object({ type: z.literal('set_focus'), focus: Focus }).strict(),
  z.object({ type: z.literal('set_party'), members: z.array(Id).max(100) }).strict(),
  z.object({ type: z.literal('set_quest'), id: Id, quest: QuestProgress }).strict(),
  z.object({ type: z.literal('set_interaction'), id: Id, interaction: Interaction }).strict(),
  z
    .object({
      type: z.literal('define_pressure'),
      pressure: Pressure.omit({ occurrences: true, lastTrigger: true }),
    })
    .strict(),
  z
    .object({
      type: z.literal('trigger_pressure'),
      id: Id,
      trigger: Text,
      evidence: z.string().min(1).max(20000),
    })
    .strict(),
  z.object({ type: z.literal('set_map'), id: Id, map: MapData }).strict(),
  z
    .object({
      type: z.literal('set_positions'),
      map: Id,
      positions: z
        .array(Position.extend({ entityId: Id }))
        .min(1)
        .max(100),
    })
    .strict(),
  z
    .object({
      type: z.literal('set_reveal'),
      map: Id,
      revealed: z.boolean(),
      nodes: z.array(Id).default([]),
      edges: z.array(MapEdge).default([]),
      cells: z.array(Cell).max(10000).default([]),
      regions: z.array(Region).max(1000).default([]),
      features: z.array(Id).default([]),
    })
    .strict(),
  z.object({ type: z.literal('register_art'), map: Id, art: MapArt }).strict(),
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
    actionId: Id.optional(),
    stepId: Id.optional(),
    expression: z.string(),
    mode: z.enum(['normal', 'advantage', 'disadvantage', 'reported']),
    dice: z.array(Int),
    modifier: Int,
    total: Int,
    purpose: Text,
    visibility: Visibility,
  })
  .strict();
export const ReviewMode = z.enum(['legacy', 'setup', 'reviewed']);
const RequiredText = z.string().trim().min(1).max(20000);
export const RuleCitation = z
  .object({
    source: z.enum(['srd-5.1', 'srd-5.2.1', 'house-rule', 'supplied-rule']),
    reference: RequiredText,
    sectionId: z.string().min(1).optional(),
    corpusRevision: z.string().min(1).optional(),
    page: Int.min(1).optional(),
  })
  .strict();
export const RefereeIdentity = z
  .object({
    host: RequiredText,
    model: RequiredText,
  })
  .strict();
export const RollStep = z
  .object({
    id: Id,
    expression: z.string().min(1).max(40),
    mode: z.enum(['normal', 'advantage', 'disadvantage']).default('normal'),
    purpose: RequiredText,
    visibility: Visibility.default('dm'),
    when: RequiredText,
    optional: z.boolean().default(false),
  })
  .strict();
export const Ruling = z
  .object({
    verdict: z.enum(['allowed', 'needs_clarification', 'not_possible', 'needs_dm_judgment']),
    reasoning: RequiredText,
    citations: z.array(RuleCitation).min(1).max(30),
    missingFacts: z.array(RequiredText).max(30).default([]),
    costs: RequiredText,
    procedure: RequiredText,
    success: RequiredText,
    failure: RequiredText,
    rolls: z.array(RollStep).max(30),
    referee: RefereeIdentity,
  })
  .strict();
export const ReviewPacket = z
  .object({
    revision: Nonnegative,
    edition: z.enum(['2014', '2024']),
    houseRules: z.array(Text),
    actors: z.array(Id).min(1).max(30),
    targets: z.array(Id).max(30),
    intent: RequiredText,
    circumstances: RequiredText,
    entities: z.array(Entity),
    encounter: Encounter.optional(),
    scene: Scene.optional(),
    time: Text.optional(),
  })
  .strict();
export const Approval = z
  .object({
    reasoning: RequiredText,
    referee: RefereeIdentity,
    citations: z.array(RuleCitation).min(1).max(30),
    changes: z.array(Change).max(100),
    skippedRolls: z
      .array(z.object({ stepId: Id, reason: RequiredText }).strict())
      .max(30)
      .default([]),
  })
  .strict();
export const ReviewAction = z
  .object({
    id: Id,
    packet: ReviewPacket,
    fingerprint: z.string(),
    status: z.enum(['prepared', 'ruled', 'approved', 'resolved', 'cancelled', 'superseded']),
    ruling: Ruling.optional(),
    approval: Approval.optional(),
    rolls: z.array(Roll).default([]),
    publicExplanation: Text.default(''),
  })
  .strict();
export type ReviewAction = z.infer<typeof ReviewAction>;
export const ReviewOperation = z.discriminatedUnion('type', [
  z.object({ type: z.literal('configure'), mode: ReviewMode, reason: RequiredText }).strict(),
  z.object({ type: z.literal('prepare'), action: ReviewAction }).strict(),
  z.object({ type: z.literal('ruling'), actionId: Id, ruling: Ruling }).strict(),
  z
    .object({
      type: z.literal('amend'),
      actionId: Id,
      reason: RequiredText,
      rolls: z.array(RollStep).min(1).max(30),
      referee: RefereeIdentity,
      citations: z.array(RuleCitation).min(1).max(30),
    })
    .strict(),
  z.object({ type: z.literal('roll'), actionId: Id, stepId: Id }).strict(),
  z.object({ type: z.literal('approve'), actionId: Id, approval: Approval }).strict(),
  z.object({ type: z.literal('commit'), actionId: Id, publicExplanation: Text }).strict(),
  z.object({ type: z.literal('cancel'), actionId: Id, reason: RequiredText }).strict(),
  z
    .object({
      type: z.literal('supersede'),
      actionId: Id,
      replacementId: Id,
      reason: RequiredText,
      packet: ReviewPacket,
    })
    .strict(),
  z
    .object({
      type: z.literal('admin'),
      actionId: Id.optional(),
      purpose: z.enum(['override', 'delegation_unavailable', 'world_preparation', 'correction']),
      closeAction: z.boolean().default(true),
      reason: RequiredText,
      ruling: RequiredText,
      publicExplanation: Text,
    })
    .strict(),
]);
export const Payload = z
  .object({
    changes: z.array(Change).max(100).default([]),
    records: z.array(JournalRecord).max(10).default([]),
    roll: Roll.optional(),
    corrects: Id.optional(),
    review: ReviewOperation.optional(),
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
  reviewMode?: z.infer<typeof ReviewMode>;
  actions?: Record<string, ReviewAction>;
  focus?: z.infer<typeof Focus>;
  party?: string[];
  pressures?: Record<string, z.infer<typeof Pressure>>;
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
