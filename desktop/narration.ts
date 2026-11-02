import type { SpeechVoice } from '#desktop/contracts';
export type NarrationVoice = SpeechVoice;

export interface NarrationMessage {
  id: string;
  campaignId: string;
  turnId: string;
  revision: number;
  eligible: boolean;
}

export interface NarrationSnapshot {
  campaignKey: string;
  active: boolean;
  messages: NarrationMessage[];
}

export interface NarrationDependencies {
  synthesize(
    message: NarrationMessage,
    voice: NarrationVoice,
    part: number,
  ): Promise<{ audio: string; nextPart?: number }>;
  cancelSynthesis(): Promise<void> | void;
  play(audio: string): Promise<void>;
  stopAudio(): void;
  onChange(state: NarrationState): void;
}

export interface NarrationState {
  activity: 'idle' | 'preparing' | 'reading' | 'error';
  currentId?: string;
  enabled: boolean;
  voice: NarrationVoice;
  error?: string;
}

export interface NarrationOptions {
  enabled?: boolean;
  voice: NarrationVoice;
}

interface QueueItem {
  message: NarrationMessage;
  part: number;
}

type SynthesisResult = Awaited<ReturnType<NarrationDependencies['synthesize']>>;
type PreparedPart = {
  item: QueueItem;
  part: number;
  // Capture errors immediately: a prefetched request can fail before playback ends.
  outcome: Promise<{ result: SynthesisResult; error?: never } | { error: unknown; result?: never }>;
};

const MAX_QUEUE = 30;

/** Coordinates automatic and manual narration without depending on a host runtime. */
export class NarrationController {
  private readonly dependencies: NarrationDependencies;
  private readonly seen = new Set<string>();
  private readonly queue: QueueItem[] = [];
  private campaignKey?: string;
  private active = false;
  private suspended = false;
  private generation = 0;
  private cancellation: Promise<void> = Promise.resolve();
  private runner?: number;
  private state: NarrationState;

  constructor(dependencies: NarrationDependencies, options: NarrationOptions) {
    this.dependencies = dependencies;
    this.state = {
      activity: 'idle',
      enabled: options.enabled ?? true,
      voice: options.voice,
    };
  }

  getState(): NarrationState {
    return { ...this.state };
  }

  /** Establishes the current transcript as history and never autoplays it. */
  reset(snapshot: NarrationSnapshot): void {
    this.queue.length = 0;
    this.invalidate();
    this.seen.clear();
    this.campaignKey = snapshot.campaignKey;
    this.active = snapshot.active;
    for (const message of snapshot.messages) this.seen.add(this.key(message));
    this.setState({ activity: 'idle', currentId: undefined, error: undefined });
  }

  /** Records every observed message, queueing only new eligible active-campaign messages. */
  observe(snapshot: NarrationSnapshot): void {
    if (this.campaignKey !== snapshot.campaignKey) {
      this.reset(snapshot);
      return;
    }

    if (!snapshot.active) {
      for (const message of snapshot.messages) this.seen.add(this.key(message));
      if (this.active || this.queue.length > 0) {
        this.active = false;
        this.queue.length = 0;
        this.invalidate();
        this.setState({ activity: 'idle', currentId: undefined, error: undefined });
      } else {
        this.active = false;
      }
      return;
    }

    this.active = true;
    for (const message of snapshot.messages) {
      const key = this.key(message);
      const isNew = !this.seen.has(key);
      this.seen.add(key);
      if (!isNew || !message.eligible || !this.state.enabled || this.suspended) continue;
      if (this.queue.length < MAX_QUEUE) {
        this.queue.push({ message: { ...message }, part: 0 });
      }
    }
    this.pump();
  }

  /** Invalidates playback on campaign exit and forgets the previous baseline. */
  leave(): void {
    this.active = false;
    this.campaignKey = undefined;
    this.seen.clear();
    this.queue.length = 0;
    this.invalidate();
    this.setState({ activity: 'idle', currentId: undefined, error: undefined });
  }

  skip(): void {
    if (this.state.activity === 'idle' && !this.state.currentId) return;
    this.queue.shift();
    this.invalidate();
    this.setState({ activity: 'idle', currentId: undefined, error: undefined });
    this.pump();
  }

  setEnabled(enabled: boolean): void {
    if (this.state.enabled === enabled && enabled) return;
    this.state = { ...this.state, enabled };
    if (!enabled) {
      this.queue.length = 0;
      this.invalidate();
      this.setState({ activity: 'idle', currentId: undefined, error: undefined });
    } else {
      this.emit();
    }
  }

  setVoice(voice: NarrationVoice): void {
    if (this.state.voice === voice) return;
    this.queue.length = 0;
    this.invalidate();
    this.state = { ...this.state, voice, activity: 'idle', currentId: undefined, error: undefined };
    this.emit();
  }

  /** Pauses narration and cancels current audio while microphone capture is active. */
  setSuspended(suspended: boolean): void {
    if (this.suspended === suspended) return;
    this.suspended = suspended;
    if (suspended) {
      this.queue.length = 0;
      this.invalidate();
      this.setState({ activity: 'idle', currentId: undefined, error: undefined });
    } else this.emit();
  }

  /** Replaces pending speech with a one-off replay, including while automatic narration is muted. */
  replay(message: NarrationMessage): void {
    if (!this.active || this.suspended || !this.seen.has(this.key(message))) return;
    this.queue.length = 0;
    this.queue.push({ message: { ...message }, part: 0 });
    this.invalidate();
    this.setState({ activity: 'idle', currentId: undefined, error: undefined });
    this.pump();
  }

  private key(message: NarrationMessage): string {
    return `${message.campaignId}\u0000${message.id}`;
  }

  private invalidate(): void {
    this.generation += 1;
    try {
      this.dependencies.stopAudio();
    } catch {
      // A failed stop must not keep stale playback eligible to resume.
    }
    this.cancelPending();
  }

  private cancelPending(): Promise<void> {
    const previous = this.cancellation;
    this.cancellation = previous
      .catch(() => undefined)
      .then(() => this.dependencies.cancelSynthesis())
      .then(
        () => undefined,
        () => undefined,
      );
    return this.cancellation;
  }

  private setState(change: Partial<NarrationState>): void {
    this.state = { ...this.state, ...change };
    this.emit();
  }

  private emit(): void {
    this.dependencies.onChange(this.getState());
  }

  private pump(): void {
    if (
      !this.active ||
      this.suspended ||
      this.queue.length === 0 ||
      this.runner === this.generation
    )
      return;
    const token = this.generation;
    this.runner = token;
    void this.runQueue(token).finally(() => {
      if (this.runner === token) this.runner = undefined;
      if (this.active && this.queue.length > 0 && this.runner === undefined) this.pump();
    });
  }

  private async runQueue(token: number): Promise<void> {
    let prepared: PreparedPart | undefined;
    const prepare = (item: QueueItem, part: number): PreparedPart => ({
      item,
      part,
      outcome: Promise.resolve()
        .then(() => {
          if (!this.isCurrent(token)) throw new Error('Speech cancelled.');
          return this.dependencies.synthesize(item.message, this.state.voice, part);
        })
        .then(
          (result) => ({ result }),
          (error) => ({ error }),
        ),
    });
    while (this.isCurrent(token) && this.queue.length > 0) {
      const item = this.queue[0];
      this.setState({ activity: 'preparing', currentId: item.message.id, error: undefined });

      try {
        await this.cancellation;
        if (!this.isCurrent(token)) return;

        const work =
          prepared?.item === item && prepared.part === item.part
            ? prepared
            : prepare(item, item.part);
        prepared = undefined;
        const outcome = await work.outcome;
        if (!this.isCurrent(token)) return;
        if ('error' in outcome) throw outcome.error;
        const result = outcome.result;

        this.setState({ activity: 'reading', currentId: item.message.id });
        const playing = this.dependencies.play(result.audio);
        // Keep just one future WAV/request in memory. Synthesis stays sequential,
        // while playback overlaps it; a rate-limited part cannot be overtaken.
        if (this.isCurrent(token)) {
          if (result.nextPart !== undefined) prepared = prepare(item, result.nextPart);
          else if (this.queue[1]) prepared = prepare(this.queue[1], this.queue[1].part);
        }
        await playing;
        if (!this.isCurrent(token)) return;

        if (result.nextPart !== undefined) {
          item.part = result.nextPart;
        } else {
          this.queue.shift();
        }
        this.setState({ activity: 'idle', currentId: undefined, error: undefined });
      } catch (error) {
        if (!this.isCurrent(token)) return;
        if (prepared) {
          prepared = undefined;
          // Playback failed while future synthesis was running. Finish cancellation
          // before advancing so it cannot cancel the next request by mistake.
          await this.cancelPending();
          if (!this.isCurrent(token)) return;
        }
        this.queue.shift();
        this.setState({
          activity: 'error',
          currentId: item.message.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    if (this.isCurrent(token) && this.queue.length === 0 && this.state.activity !== 'error') {
      this.setState({ activity: 'idle', currentId: undefined });
    }
  }

  private isCurrent(token: number): boolean {
    return this.active && !this.suspended && token === this.generation;
  }
}
