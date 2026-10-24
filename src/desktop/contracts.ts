import { z } from 'zod';
import { GroupAction, Id, Viewport } from '../schema.js';
import type { State, TableTurn } from '../schema.js';
import type { playerView } from '../player-view.js';
import { SubmitRollInput } from './player-roll.js';
export { SubmitRollInput } from './player-roll.js';

export const SubmitInput = z
  .object({
    id: Id,
    characterId: Id.optional(),
    text: z.string().trim().min(1).max(20000),
    actions: z.array(GroupAction).max(20).optional(),
    groupEpoch: z.number().int().nonnegative().optional(),
  })
  .strict();
export const CreateInput = z
  .object({
    parent: z.string().min(1).optional(),
    slug: z.string().regex(/^[a-z0-9][a-z0-9-]{0,79}$/),
    name: z.string().trim().min(1).max(200),
    edition: z.enum(['2014', '2024']),
  })
  .strict();
export const MapInput = z
  .object({
    mapId: Id,
    revision: z.number().int().nonnegative(),
    viewport: Viewport.optional(),
    details: z.boolean().optional(),
  })
  .strict();
export const SpeechInput = z
  .object({
    campaignId: Id,
    turnId: Id,
    revision: z.number().int().positive().safe(),
    voice: z.enum(['Easton', 'Zoey']),
    part: z.number().int().min(0).max(2000),
  })
  .strict();
export type SpeechInput = z.infer<typeof SpeechInput>;
export interface SpeechResult {
  audio: string;
  nextPart?: number;
}
export interface SpeechStatus {
  available: boolean;
  detail: string;
}
export interface SpeechInstallState {
  phase: 'unconfigured' | 'declined' | 'installing' | 'ready' | 'error';
  detail: string;
  accepted: boolean;
  licenseRevision: string;
  bundled?: boolean;
}
export const SpeechInstallInput = z
  .object({
    accepted: z.literal(true),
    licenseRevision: z.string().min(1).max(200),
    token: z
      .string()
      .trim()
      .min(1)
      .max(1024)
      .regex(/^[A-Za-z0-9_-]+$/)
      .optional(),
  })
  .strict();
export type SpeechInstallInput = z.infer<typeof SpeechInstallInput>;
export const SpeechLink = z.enum(['license', 'model', 'token']);
export type SpeechLink = z.infer<typeof SpeechLink>;
export const IntentInput = z
  .object({
    id: z.string().uuid(),
    epoch: z.number().int().nonnegative(),
    text: z.string().trim().max(10000),
    confirmed: z.boolean(),
    pass: z.boolean(),
    sendNow: z.boolean().default(false),
  })
  .strict();
export const LanAdminInput = z.discriminatedUnion('action', [
  z.object({ action: z.literal('assign'), clientId: z.string(), characterId: Id }).strict(),
  z.object({ action: z.literal('remove'), clientId: z.string() }).strict(),
  z.object({ action: z.literal('release'), clientId: z.string() }).strict(),
  z.object({ action: z.literal('skip'), characterId: Id }).strict(),
  z.object({ action: z.literal('rotate') }).strict(),
  z.object({ action: z.literal('resolve') }).strict(),
  z.object({ action: z.literal('continue') }).strict(),
]);
export const Provider = z.enum(['antigravity', 'codex', 'ollama']);
export type Provider = z.infer<typeof Provider>;
export const ModelId = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9._:/-]*$/);
export interface ModelCatalog {
  models: { id: string; name: string; description?: string; isDefault?: boolean }[];
  defaultModel?: string;
}
// Only local metadata endpoints are contacted here; model inference stays in the CLI.
export const LocalSettings = z
  .object({
    endpoint: z
      .string()
      .url()
      .max(300)
      .refine((value) => {
        const u = new URL(value);
        return (
          u.protocol === 'http:' &&
          ['127.0.0.1', '[::1]', 'localhost'].includes(u.hostname) &&
          !u.username &&
          !u.password &&
          !u.search &&
          !u.hash &&
          u.pathname === '/'
        );
      }, 'Use a loopback Ollama URL, such as http://127.0.0.1:11434'),
    model: z
      .string()
      .trim()
      .min(1)
      .max(200)
      .regex(/^[a-zA-Z0-9][a-zA-Z0-9._:/-]*$/),
    contextTokens: z.number().int().min(32768).max(262144),
  })
  .strict();
export type LocalSettings = z.infer<typeof LocalSettings>;
export interface LocalModels {
  hardware: { ramGiB: number; gpu?: string; vramGiB?: number; unifiedMemory: boolean };
  models: { name: string; sizeGiB: number }[];
  suggestions: { model: string; reason: string }[];
  selected?: { capabilities: string[]; maxContext: number; configuredContext?: number };
  warning?: string;
}
export const Preferences = z
  .object({
    executable: z.string().optional(),
    codexExecutable: z.string().optional(),
    local: LocalSettings.optional(),
    provider: Provider.optional(),
    models: z
      .object({ antigravity: ModelId.optional(), codex: ModelId.optional() })
      .strict()
      .optional(),
    recent: z.string().optional(),
  })
  .strict();
export type Preferences = z.infer<typeof Preferences>;
export type SubmitInput = z.infer<typeof SubmitInput>;
export type CreateInput = z.infer<typeof CreateInput>;
export type MapInput = z.infer<typeof MapInput>;
export type IntentInput = z.infer<typeof IntentInput>;
export type LanAdminInput = z.infer<typeof LanAdminInput>;
export type Stage = 'disconnected' | 'connecting' | 'ready' | 'resolving' | 'attention';
export type PlayerView = ReturnType<typeof playerView>;
export interface RollCard {
  id: string;
  revision: number;
  characterId?: string;
  characterName?: string;
  label: string;
  notation: string;
  mode: 'normal' | 'advantage' | 'disadvantage' | 'reported';
  dice: number[];
  modifier: number;
  total: number;
  source: 'digital' | 'physical';
}
export interface PendingRollCard {
  id: string;
  characterId: string;
  characterName: string;
  label: string;
  notation: string;
  mode: 'normal' | 'advantage' | 'disadvantage';
  dieCount: number;
  dieSides: number;
}
export interface CampaignActivity {
  phase?: string;
  rolls: {
    id: string;
    label: string;
    notation: string;
    mode?: 'normal' | 'advantage' | 'disadvantage' | 'reported';
    status: 'rolling' | 'complete' | 'failed';
    total?: number;
    dice?: number[];
    modifier?: number;
  }[];
}
export const DesktopEvent = z
  .object({
    type: z.literal('desktop-event'),
    root: z.string(),
    campaignId: z.string(),
    sequence: z.number().int().nonnegative(),
    kind: z.enum(['activity', 'changed']),
    stage: z.enum(['disconnected', 'connecting', 'ready', 'resolving', 'attention']),
    detail: z.string(),
    activity: z
      .object({
        phase: z.string().max(80).optional(),
        rolls: z
          .array(
            z
              .object({
                id: z.string().min(1).max(100),
                label: z.string().min(1).max(80),
                notation: z.string().min(1).max(80),
                mode: z.enum(['normal', 'advantage', 'disadvantage', 'reported']).optional(),
                status: z.enum(['rolling', 'complete', 'failed']),
                total: z.number().int().safe().optional(),
                dice: z.array(z.number().int().safe()).max(100).optional(),
                modifier: z.number().int().safe().optional(),
              })
              .strict(),
          )
          .max(12),
      })
      .strict()
      .optional(),
  })
  .strict();
export type DesktopEvent = z.infer<typeof DesktopEvent>;
export type CampaignSnapshot = PlayerView & {
  pendingRolls: PendingRollCard[];
  rollHistory: RollCard[];
  root: string;
  table: TableTurn[];
  gathering?: State['gathering'];
  stage: Stage;
  detail: string;
  reviewMode: 'legacy' | 'setup' | 'reviewed';
  lanHosted: boolean;
  provider?: Provider;
  model?: string;
  speechEligibleRevisions?: number[];
  activity?: CampaignActivity;
  activitySequence?: number;
};
export type DesktopSnapshot =
  CampaignSnapshot | { campaign: null; stage: Stage; detail: string; table: TableTurn[] };
export type MapResult =
  | { stale: true; busy?: never }
  | { busy: true; stale?: never }
  | { stale?: never; busy?: never; revision: number; image: string; warnings: string[] };
export interface Player {
  id: string;
  name: string;
  characterId?: string;
  connected: boolean;
}
export interface LanStatus {
  urls: string[];
  qrs: string[];
  players: Player[];
}
export type LanSnapshot = PlayerView & {
  pendingRolls: PendingRollCard[];
  rollHistory: RollCard[];
  table: TableTurn[];
  gathering?: State['gathering'];
  stage: Stage;
  players: Player[];
  self: { id: string; characterId?: string };
  required: string[];
};
export interface WorkerApi {
  localModels(settings: LocalSettings): Promise<LocalModels>;
  detect(path?: string, provider?: Provider): Promise<{ path: string; version: string }>;
  models(path?: string, provider?: Provider, local?: LocalSettings): Promise<ModelCatalog>;
  create(input: CreateInput): Promise<DesktopSnapshot>;
  open(root: string): Promise<DesktopSnapshot>;
  connect(
    executable?: string,
    fresh?: boolean,
    provider?: Provider,
    local?: LocalSettings,
    model?: string,
  ): Promise<{ connected: boolean; path: string; version: string }>;
  submit(input: SubmitInput): Promise<{ id: string; duplicate: boolean }>;
  submitRoll(
    input: z.input<typeof SubmitRollInput>,
  ): Promise<{ id: string; duplicate: boolean; roll?: unknown }>;
  beginSetup(): Promise<void>;
  snapshot(): Promise<DesktopSnapshot>;
  map(input: MapInput): Promise<MapResult>;
  speech(input: SpeechInput): Promise<SpeechResult>;
  speechStatus(): Promise<SpeechStatus>;
  cancelSpeech(): Promise<void>;
  speechSetupStatus(): Promise<SpeechInstallState>;
  installSpeech(input: SpeechInstallInput): Promise<SpeechInstallState>;
  declineSpeech(): Promise<SpeechInstallState>;
  cancelSpeechInstall(): Promise<SpeechInstallState>;
  stop(): Promise<void>;
  startLan(): Promise<LanStatus>;
  stopLan(): Promise<void>;
  lanStatus(): Promise<LanStatus | null>;
  lanAdmin(input: LanAdminInput): Promise<LanStatus>;
}
export interface DesktopApi extends Omit<WorkerApi, 'connect' | 'detect' | 'models'> {
  onUpdate(callback: (event: DesktopEvent) => void): () => void;
  openSpeechLink(link: SpeechLink): Promise<void>;
  detect(path?: string): Promise<{ path: string; version: string }>;
  models(): Promise<ModelCatalog>;
  selectModel(model?: string): Promise<void>;
  switchModel(model?: string): Promise<void>;
  preferences(): Promise<Preferences>;
  configureLocal(settings: LocalSettings): Promise<void>;
  selectProvider(provider: Provider): Promise<void>;
  chooseExecutable(): Promise<string | null>;
  chooseParent(): Promise<string | null>;
  chooseCampaign(): Promise<string | null>;
  connect(fresh?: boolean): Promise<{ connected: boolean; path: string; version: string }>;
  joinLan(link: string): Promise<void>;
}
export const LanJoinInput = z
  .object({ invitation: z.string(), name: z.string().trim().min(1).max(40) })
  .strict();
export const LanClaimInput = z.object({ characterId: Id }).strict();
export interface LanRequests {
  join: z.infer<typeof LanJoinInput>;
  state: undefined;
  map: MapInput;
  claim: z.infer<typeof LanClaimInput>;
  intent: IntentInput;
  roll: z.input<typeof SubmitRollInput>;
}
export interface LanResponses {
  join: { token: string; clientId: string };
  state: LanSnapshot;
  map: MapResult;
  claim: { ok: boolean };
  intent: { ok: boolean; duplicate?: boolean };
  roll: { id: string; duplicate: boolean; roll?: unknown };
}
export const WorkerEnvelope = z
  .object({ id: z.number().int().safe(), method: z.string(), args: z.array(z.unknown()) })
  .strict();
export const WorkerReply = z
  .object({
    id: z.number().int().safe(),
    result: z.unknown().optional(),
    error: z.string().optional(),
  })
  .strict();

const OptionalWireString = z
  .string()
  .nullish()
  .transform((value) => value ?? undefined);
const OptionalWireBoolean = z
  .boolean()
  .nullish()
  .transform((value) => value ?? undefined);
const OptionalWireModel = ModelId.nullish().transform((value) => value ?? undefined);

// Dispatch parses unknown transport input before calling a typed handler. No method lookup casts.
export async function dispatchWorker(
  api: WorkerApi,
  method: string,
  raw: unknown,
): Promise<unknown> {
  switch (method) {
    case 'detect':
      return api.detect(
        ...z
          .union([
            z.tuple([]),
            z.tuple([OptionalWireString]),
            z.tuple([OptionalWireString, Provider.optional()]),
          ])
          .parse(raw),
      );
    case 'localModels':
      return api.localModels(...z.tuple([LocalSettings]).parse(raw));
    case 'models': {
      const args = z
        .union([
          z.tuple([]),
          z.tuple([OptionalWireString]),
          z.tuple([OptionalWireString, Provider]),
          z.tuple([
            OptionalWireString,
            Provider,
            LocalSettings.nullish().transform((value) => value ?? undefined),
          ]),
        ])
        .parse(raw);
      return args.length === 3
        ? api.models(args[0], args[1], args[2])
        : args.length === 2
          ? api.models(args[0], args[1])
          : api.models(args[0]);
    }
    case 'create':
      return api.create(...z.tuple([CreateInput]).parse(raw));
    case 'open':
      return api.open(...z.tuple([z.string().min(1)]).parse(raw));
    case 'connect': {
      const args = z
        .union([
          z.tuple([]),
          z.tuple([OptionalWireString]),
          z.tuple([OptionalWireString, OptionalWireBoolean]),
          z.tuple([OptionalWireString, OptionalWireBoolean, Provider]),
          z.tuple([
            OptionalWireString,
            OptionalWireBoolean,
            Provider,
            LocalSettings.nullish().transform((value) => value ?? undefined),
          ]),
          z.tuple([
            OptionalWireString,
            OptionalWireBoolean,
            Provider,
            LocalSettings.nullish().transform((value) => value ?? undefined),
            OptionalWireModel,
          ]),
        ])
        .parse(raw);
      return args.length === 5
        ? api.connect(args[0], args[1], args[2], args[3], args[4])
        : args.length === 4
          ? api.connect(args[0], args[1], args[2], args[3])
          : api.connect(args[0], args[1], args[2]);
    }
    case 'submit':
      return api.submit(...z.tuple([SubmitInput]).parse(raw));
    case 'submitRoll':
      return api.submitRoll(...z.tuple([SubmitRollInput]).parse(raw));
    case 'beginSetup':
      z.tuple([]).parse(raw);
      return api.beginSetup();
    case 'map':
      return api.map(...z.tuple([MapInput]).parse(raw));
    case 'speech':
      return api.speech(...z.tuple([SpeechInput]).parse(raw));
    case 'speechStatus':
      z.tuple([]).parse(raw);
      return api.speechStatus();
    case 'cancelSpeech':
      z.tuple([]).parse(raw);
      return api.cancelSpeech();
    case 'speechSetupStatus':
      z.tuple([]).parse(raw);
      return api.speechSetupStatus();
    case 'installSpeech':
      // Never return validator details containing a submitted credential.
      if (!z.tuple([SpeechInstallInput]).safeParse(raw).success)
        throw new Error('Confirm the narration terms and provide a valid download credential.');
      return api.installSpeech(...z.tuple([SpeechInstallInput]).parse(raw));
    case 'declineSpeech':
      z.tuple([]).parse(raw);
      return api.declineSpeech();
    case 'cancelSpeechInstall':
      z.tuple([]).parse(raw);
      return api.cancelSpeechInstall();
    case 'lanAdmin':
      return api.lanAdmin(...z.tuple([LanAdminInput]).parse(raw));
    case 'snapshot':
      z.tuple([]).parse(raw);
      return api.snapshot();
    case 'stop':
      z.tuple([]).parse(raw);
      return api.stop();
    case 'startLan':
      z.tuple([]).parse(raw);
      return api.startLan();
    case 'stopLan':
      z.tuple([]).parse(raw);
      return api.stopLan();
    case 'lanStatus':
      z.tuple([]).parse(raw);
      return api.lanStatus();
    default:
      throw new Error('Invalid worker method');
  }
}
export async function dispatchDesktop(
  api: Omit<DesktopApi, 'onUpdate'>,
  method: unknown,
  raw: unknown,
): Promise<unknown> {
  if (typeof method !== 'string') throw new Error('Invalid desktop method');
  switch (method) {
    case 'openSpeechLink':
      return api.openSpeechLink(...z.tuple([SpeechLink]).parse(raw));
    case 'models':
      z.tuple([]).parse(raw);
      return api.models();
    case 'selectModel':
      return api.selectModel(...z.union([z.tuple([]), z.tuple([OptionalWireModel])]).parse(raw));
    case 'switchModel':
      return api.switchModel(...z.union([z.tuple([]), z.tuple([OptionalWireModel])]).parse(raw));
    case 'detect':
      return api.detect(...z.union([z.tuple([]), z.tuple([OptionalWireString])]).parse(raw));
    case 'configureLocal':
      return api.configureLocal(...z.tuple([LocalSettings]).parse(raw));
    case 'selectProvider':
      return api.selectProvider(...z.tuple([Provider]).parse(raw));
    case 'preferences':
      z.tuple([]).parse(raw);
      return api.preferences();
    case 'chooseExecutable':
      z.tuple([]).parse(raw);
      return api.chooseExecutable();
    case 'chooseParent':
      z.tuple([]).parse(raw);
      return api.chooseParent();
    case 'chooseCampaign':
      z.tuple([]).parse(raw);
      return api.chooseCampaign();
    case 'joinLan':
      return api.joinLan(...z.tuple([z.string().url()]).parse(raw));
    case 'connect':
      return api.connect(...z.union([z.tuple([]), z.tuple([z.boolean().optional()])]).parse(raw));
    default:
      return dispatchWorker(
        {
          ...api,
          connect: async () => {
            throw new Error('Invalid desktop method');
          },
        },
        method,
        raw,
      );
  }
}
