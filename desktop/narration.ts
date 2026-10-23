export type NarrationVoice = 'Easton' | 'Zoey';

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

const MAX_QUEUE = 30;

/** Coordinates automatic and manual narration without depending on a host runtime. */
export class NarrationController {
  private readonly dependencies: NarrationDependencies;
  private readonly seen = new Set<string>();
  private readonly queue: QueueItem[] = [];
  private campaignKey?: string;
  private active = false;
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
      if (!isNew || !message.eligible || !this.state.enabled) continue;
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

  /** Replaces pending speech with a one-off replay, including while automatic narration is muted. */
  replay(message: NarrationMessage): void {
    if (!this.active || !this.seen.has(this.key(message))) return;
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
    const previous = this.cancellation;
    this.cancellation = previous
      .catch(() => undefined)
      .then(() => this.dependencies.cancelSynthesis())
      .then(
        () => undefined,
        () => undefined,
      );
  }

  private setState(change: Partial<NarrationState>): void {
    this.state = { ...this.state, ...change };
    this.emit();
  }

  private emit(): void {
    this.dependencies.onChange(this.getState());
  }

  private pump(): void {
    if (!this.active || this.queue.length === 0 || this.runner === this.generation) return;
    const token = this.generation;
    this.runner = token;
    void this.runQueue(token).finally(() => {
      if (this.runner === token) this.runner = undefined;
      if (this.active && this.queue.length > 0 && this.runner === undefined) this.pump();
    });
  }

  private async runQueue(token: number): Promise<void> {
    while (this.isCurrent(token) && this.queue.length > 0) {
      const item = this.queue[0];
      const voice = this.state.voice;
      this.setState({ activity: 'preparing', currentId: item.message.id, error: undefined });

      try {
        await this.cancellation;
        if (!this.isCurrent(token)) return;

        const result = await this.dependencies.synthesize(item.message, voice, item.part);
        if (!this.isCurrent(token)) return;

        this.setState({ activity: 'reading', currentId: item.message.id });
        await this.dependencies.play(result.audio);
        if (!this.isCurrent(token)) return;

        if (result.nextPart !== undefined) {
          item.part = result.nextPart;
        } else {
          this.queue.shift();
        }
        this.setState({ activity: 'idle', currentId: undefined, error: undefined });
      } catch (error) {
        if (!this.isCurrent(token)) return;
        this.queue.shift();
        this.setState({
          activity: 'error',
          currentId: item.message.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    if (this.active && this.queue.length === 0 && this.state.activity !== 'error') {
      this.setState({ activity: 'idle', currentId: undefined });
    }
  }

  private isCurrent(token: number): boolean {
    return this.active && token === this.generation;
  }
}
