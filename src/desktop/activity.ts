import { z } from 'zod';
import { readFile, mkdir, stat } from 'node:fs/promises';
import { safePath, atomicWrite, type CampaignStore } from '../store.js';
import { inputs } from '../service.js';

export const ActivityRoll = z
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
  .strict();

export const ActivitySnapshot = z.object({
  phase: z.string().max(80).optional(),
  rolls: z.array(ActivityRoll).max(12),
});

const Feed = ActivitySnapshot.extend({
  ownerToken: z.string().uuid(),
  requestId: z.string().optional(),
}).strict();
export type ActivitySnapshot = z.infer<typeof ActivitySnapshot>;
type ActivityRoll = z.infer<typeof ActivityRoll>;

/** Owner-token-bound ephemeral feedback. It intentionally stores no tool input or output. */
export class DesktopActivity {
  private value: ActivitySnapshot = { rolls: [] };
  private requestId?: string;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private store: CampaignStore,
    private ownerToken: string,
  ) {}

  async reset() {
    return this.enqueue(async () => {
      this.value = { rolls: [] };
      this.requestId = undefined;
      await this.save();
    });
  }

  async beginTool(name: string, raw: unknown): Promise<string | undefined> {
    return this.enqueue(async () => {
      await this.refresh();
      const schema = (inputs as Record<string, z.ZodType>)[name];
      const parsed = schema?.safeParse(raw);
      if (schema && !parsed?.success) return undefined;
      const phase = phaseFor(name);
      this.value = { rolls: this.value.rolls, ...(phase ? { phase } : {}) };
      this.requestId = undefined;
      if (phase) {
        const { state } = await this.store.read();
        const requestId = [...(state.table ?? [])]
          .reverse()
          .find((turn) => turn.status === 'pending')?.id;
        this.requestId = requestId;
        this.value = { ...this.value, phase };
      }
      const input = parsed?.success
        ? (parsed.data as Record<string, unknown>)
        : raw && typeof raw === 'object'
          ? (raw as Record<string, unknown>)
          : {};
      // Require the declared public visibility before showing even a generic pending roll.
      const rollInput =
        name === 'roll_dice'
          ? input
          : name === 'administer_campaign' && input.roll && typeof input.roll === 'object'
            ? (input.roll as Record<string, unknown>)
            : undefined;
      if (rollInput && rollInput.visibility === 'party' && typeof input.operationId === 'string') {
        const notation = typeof rollInput.expression === 'string' ? rollInput.expression : '';
        const mode = ['normal', 'advantage', 'disadvantage', 'reported'].includes(
          String(rollInput.mode),
        )
          ? (rollInput.mode as ActivityRoll['mode'])
          : 'normal';
        if (/^\d{1,3}d\d{1,5}(?:[+-]\d{1,6})?$/i.test(notation)) {
          const id = input.operationId.slice(0, 100);
          const existing = this.value.rolls.find((r) => r.id === id);
          if (!existing || existing.status !== 'complete') {
            this.putRoll({
              id,
              label: safeLabel(rollInput.purpose),
              notation,
              mode,
              status: 'rolling',
            });
            await this.save();
            return id;
          }
        }
      }
      await this.save();
      return undefined;
    });
  }

  async finishTool(operationId: string | undefined, error?: unknown) {
    return this.enqueue(async () => {
      await this.refresh();
      if (!operationId) {
        await this.save();
        return;
      }
      const { events } = await this.store.read();
      const event = events.find((e) => e.operationId === operationId && e.payload.roll);
      const roll = event?.payload.roll;
      if (event && roll?.visibility === 'party') {
        this.updateRoll(operationId, (pending) => ({
          id: pending.id,
          label: safeLabel(roll.purpose),
          notation: roll.expression,
          mode: roll.mode,
          status: 'complete',
          total: roll.total,
          dice: roll.dice,
          modifier: roll.modifier,
        }));
        await this.save().catch(() => {});
        return;
      }
      if (error) {
        this.updateRoll(operationId, (pending) => ({
          id: pending.id,
          label: pending.label,
          notation: pending.notation,
          ...(pending.mode ? { mode: pending.mode } : {}),
          status: 'failed',
        }));
        await this.save();
        return;
      }
      this.removeRoll(operationId);
      await this.save();
    });
  }

  async snapshot(ownerToken: string, activeRequestId?: string | null): Promise<ActivitySnapshot> {
    if (ownerToken !== this.ownerToken) return { rolls: [] };
    try {
      const path = await safePath(this.store.root, '.dm/hotseat/activity.json');
      if ((await stat(path)).size > 32768) return { rolls: [] };
      const feed = Feed.parse(JSON.parse(await readFile(path, 'utf8')));
      if (feed.ownerToken !== ownerToken) return { rolls: [] };
      return {
        ...(feed.phase && (activeRequestId === undefined || feed.requestId === activeRequestId)
          ? { phase: feed.phase }
          : {}),
        rolls: feed.rolls,
      };
    } catch {
      return { rolls: [] };
    }
  }

  private async refresh() {
    try {
      const path = await safePath(this.store.root, '.dm/hotseat/activity.json');
      if ((await stat(path)).size > 32768) return;
      const feed = Feed.parse(JSON.parse(await readFile(path, 'utf8')));
      if (feed.ownerToken === this.ownerToken) {
        this.requestId = feed.requestId;
        this.value = { ...(feed.phase ? { phase: feed.phase } : {}), rolls: feed.rolls };
      }
    } catch {
      // The feed is best-effort and can be rebuilt from current tool activity.
    }
  }

  private putRoll(roll: ActivityRoll) {
    const rolls = this.value.rolls.filter((item) => item.id !== roll.id);
    rolls.push(roll);
    this.value = { ...this.value, rolls: rolls.slice(-12) };
  }
  private updateRoll(id: string, update: (roll: ActivityRoll) => ActivityRoll) {
    const roll = this.value.rolls.find((item) => item.id === id);
    if (roll)
      this.value = {
        ...this.value,
        rolls: this.value.rolls.map((item) => (item.id === id ? update(item) : item)),
      };
  }
  private removeRoll(id: string) {
    this.value = { ...this.value, rolls: this.value.rolls.filter((item) => item.id !== id) };
  }
  private save() {
    return (async () => {
      const ownerPath = await safePath(this.store.root, '.dm/hotseat/owner.json');
      const owner = JSON.parse(await readFile(ownerPath, 'utf8')) as { token?: string };
      if (owner.token !== this.ownerToken) return;
      const directory = await safePath(this.store.root, '.dm/hotseat', false);
      await mkdir(directory, { recursive: true });
      const path = await safePath(this.store.root, '.dm/hotseat/activity.json', false);
      await atomicWrite(
        path,
        JSON.stringify({
          ...this.value,
          ownerToken: this.ownerToken,
          ...(this.value.phase && this.requestId ? { requestId: this.requestId } : {}),
        }),
      );
    })();
  }
  private enqueue<T>(action: () => Promise<T>): Promise<T> {
    const next = this.queue.then(action, action);
    this.queue = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }
}

function safeLabel(purpose: unknown) {
  if (typeof purpose !== 'string') return 'Dice roll';
  const value = purpose.trim().toLowerCase();
  const labels = new Map<string, string>();
  for (const name of [
    'perception',
    'insight',
    'stealth',
    'investigation',
    'athletics',
    'acrobatics',
    'arcana',
    'history',
    'nature',
    'religion',
    'survival',
    'persuasion',
    'deception',
    'intimidation',
    'performance',
    'sleight of hand',
    'animal handling',
    'medicine',
  ]) {
    const label = `${name[0].toUpperCase()}${name.slice(1)} Check`;
    labels.set(name, label);
    labels.set(`${name} check`, label);
  }
  labels.set('initiative', 'Initiative');
  labels.set('attack', 'Attack');
  labels.set('damage', 'Damage');
  for (const name of [
    'strength',
    'dexterity',
    'constitution',
    'intelligence',
    'wisdom',
    'charisma',
  ]) {
    const label = `${name[0].toUpperCase()}${name.slice(1)} Save`;
    labels.set(`${name} save`, label);
    labels.set(`${name} saving throw`, label);
  }
  labels.set('will save', 'Wisdom Save');
  return labels.get(value) ?? 'Dice roll';
}

function phaseFor(name: string): string | undefined {
  if (/^(search_rules|read_rules|list_rule_sections)$/.test(name)) return 'Checking rules';
  if (/^search_|^read_campaign_record$|^resume_campaign$/.test(name)) return 'Consulting notes';
  if (
    /^(prepare_action|amend_action_rolls|approve_action_effects|commit_action|cancel_action|supersede_action|administer_campaign)$/.test(
      name,
    )
  )
    return 'Checking rules';
  if (
    /^(roll_dice|apply_campaign_changes|correct_campaign_event|record_scene|checkpoint_session|publish_table_message|create_location_map|register_map_art)$/.test(
      name,
    )
  )
    return 'Saving outcome';
  return undefined;
}
