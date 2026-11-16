export class AgentTimeoutError extends Error {
  constructor(provider: string) {
    super(
      `${provider} timed out. Saved changes remain intact; review the table before continuing.`,
    );
    this.name = 'AgentTimeoutError';
  }
}

const PUBLICATION_CHECK_TIMEOUT_MS = 1000;
const DEFAULT_FINISHING_GRACE_MS = 90000;

export interface TurnDeadlineOptions {
  timeoutMs: number;
  requestId?: string;
  finishingGraceMs?: number;
  pollIntervalMs?: number;
  isAwaitingPlayerRoll?: (requestId: string) => Promise<boolean>;
  playerRollWaitMs?: (requestId: string) => Promise<number> | number;
  hasPublishedResponse?: (requestId: string) => Promise<boolean>;
  onFinishingGrace?: () => void;
  onTimeout: () => void;
}

/** Bounds provider turns, pausing/crediting player roll wait time and allowing one cleanup window after a saved final response. */
export class TurnDeadline {
  private timer?: NodeJS.Timeout;
  private probeTimer?: NodeJS.Timeout;
  private probing = false;
  private expiring = false;
  private cancelled = false;
  private graceGranted = false;
  private paused = false;
  private remainingMs: number;
  private segmentStartedAt?: number;
  private segmentPlannedMs = 0;
  private pausedAt?: number;
  private tickElapsedMs = 0;
  private pausedTickMs = 0;
  private creditedRollWaitMs = 0;

  constructor(private readonly options: TurnDeadlineOptions) {
    this.remainingMs = Math.max(0, options.timeoutMs);
  }

  start(): void {
    if (this.cancelled || this.graceGranted) return;
    if (!this.paused && !this.timer) {
      this.armTimer(this.remainingMs);
    }
    this.scheduleProbe();
  }

  pause(): void {
    if (this.cancelled || this.graceGranted || this.paused) return;
    this.paused = true;
    const now = Date.now();
    this.pausedAt = now;
    this.pausedTickMs = 0;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
      const wallElapsed =
        this.segmentStartedAt !== undefined ? Math.max(0, now - this.segmentStartedAt) : 0;
      const elapsed = Math.max(wallElapsed, this.tickElapsedMs);
      this.remainingMs = Math.max(0, this.remainingMs - elapsed);
    }
    this.segmentStartedAt = undefined;
    this.segmentPlannedMs = 0;
    this.tickElapsedMs = 0;
  }

  resume(): void {
    if (this.cancelled || this.graceGranted || !this.paused) return;
    const now = Date.now();
    const wallWaited = this.pausedAt !== undefined ? Math.max(0, now - this.pausedAt) : 0;
    const waited = Math.max(wallWaited, this.pausedTickMs);
    this.creditedRollWaitMs += waited;
    this.paused = false;
    this.pausedAt = undefined;
    this.pausedTickMs = 0;
    if (!this.expiring) {
      this.armTimer(this.remainingMs);
      this.scheduleProbe();
    }
  }

  credit(ms: number): void {
    if (this.cancelled || this.graceGranted || !(ms > 0)) return;
    this.creditedRollWaitMs += ms;
    this.remainingMs += ms;
    if (this.timer && !this.paused && !this.expiring) {
      const now = Date.now();
      const wallElapsed =
        this.segmentStartedAt !== undefined ? Math.max(0, now - this.segmentStartedAt) : 0;
      const elapsed = Math.max(wallElapsed, this.tickElapsedMs);
      this.remainingMs = Math.max(0, this.remainingMs - elapsed);
      this.tickElapsedMs = 0;
      this.armTimer(this.remainingMs);
    }
  }

  cancel(): void {
    this.cancelled = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    this.stopProbe();
  }

  private armTimer(delayMs: number): void {
    if (this.cancelled || this.paused) return;
    if (this.timer) clearTimeout(this.timer);
    const wait = Math.max(0, delayMs);
    this.segmentStartedAt = Date.now();
    this.segmentPlannedMs = wait;
    this.tickElapsedMs = 0;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.expire();
    }, wait);
  }

  private probeIntervalMs(): number | undefined {
    if (!this.options.requestId || !this.options.isAwaitingPlayerRoll) return undefined;
    if (this.options.pollIntervalMs !== undefined) return Math.max(1, this.options.pollIntervalMs);
    if (this.options.timeoutMs <= 20) return undefined;
    return Math.min(100, Math.max(10, Math.floor(this.options.timeoutMs / 5)));
  }

  private scheduleProbe(): void {
    if (this.cancelled || this.graceGranted || this.probeTimer) return;
    const interval = this.probeIntervalMs();
    if (interval === undefined) return;
    const tick = () => {
      this.probeTimer = undefined;
      if (this.cancelled || this.graceGranted || this.expiring) return;
      if (this.paused) this.pausedTickMs += interval;
      else this.tickElapsedMs += interval;
      this.probeTimer = setTimeout(tick, interval);
      void this.probe();
    };
    this.probeTimer = setTimeout(tick, interval);
  }

  private stopProbe(): void {
    if (this.probeTimer) clearTimeout(this.probeTimer);
    this.probeTimer = undefined;
  }

  private async probe(): Promise<void> {
    if (this.cancelled || this.graceGranted || this.expiring || this.probing) return;
    const checkFn = this.options.isAwaitingPlayerRoll;
    if (!checkFn || !this.options.requestId) return;
    this.probing = true;
    try {
      const waiting = await this.check(checkFn);
      if (this.cancelled || this.graceGranted || this.expiring) return;
      if (waiting && !this.paused) {
        this.pause();
      } else if (!waiting && this.paused) {
        this.resume();
      }
    } finally {
      this.probing = false;
    }
  }

  private async expire(): Promise<void> {
    if (this.cancelled || this.paused) return;
    this.expiring = true;
    this.stopProbe();
    try {
      const now = Date.now();
      const wallElapsed =
        this.segmentStartedAt !== undefined ? Math.max(0, now - this.segmentStartedAt) : 0;
      const elapsed = Math.max(this.segmentPlannedMs, wallElapsed, this.tickElapsedMs);
      this.segmentStartedAt = undefined;
      this.segmentPlannedMs = 0;
      this.tickElapsedMs = 0;

      if (this.options.requestId && this.options.isAwaitingPlayerRoll) {
        const checkStartedAt = Date.now();
        const waiting = await this.check(this.options.isAwaitingPlayerRoll);
        if (this.cancelled || this.paused) return;
        if (waiting) {
          this.creditedRollWaitMs += Math.max(elapsed, Date.now() - checkStartedAt);
          this.remainingMs = Math.max(this.remainingMs, this.options.timeoutMs);
          this.armTimer(this.remainingMs);
          this.scheduleProbe();
          return;
        }
      }

      this.remainingMs = Math.max(0, this.remainingMs - elapsed);

      if (this.options.requestId && this.options.playerRollWaitMs) {
        const totalWaitMs = await this.checkDuration(this.options.playerRollWaitMs);
        if (this.cancelled || this.paused) return;
        const uncredited = Math.max(0, totalWaitMs - this.creditedRollWaitMs);
        if (uncredited > 0) {
          this.creditedRollWaitMs += uncredited;
          this.remainingMs += uncredited;
        }
      }

      if (this.remainingMs > 0) {
        this.armTimer(this.remainingMs);
        this.scheduleProbe();
        return;
      }

      if (!this.graceGranted && this.options.requestId && this.options.hasPublishedResponse) {
        const published = await this.check(this.options.hasPublishedResponse);
        if (published && !this.cancelled) {
          this.graceGranted = true;
          try {
            this.options.onFinishingGrace?.();
          } catch {
            /* Progress reporting cannot interfere with the provider deadline. */
          }
          this.timer = setTimeout(
            () => {
              this.timer = undefined;
              if (!this.cancelled) this.options.onTimeout();
            },
            Math.max(0, this.options.finishingGraceMs ?? DEFAULT_FINISHING_GRACE_MS),
          );
          return;
        }
      }
      if (!this.cancelled) this.options.onTimeout();
    } finally {
      this.expiring = false;
    }
  }

  private async check(check: (requestId: string) => Promise<boolean>): Promise<boolean> {
    const requestId = this.options.requestId;
    if (!requestId || !check) return false;

    let timer: NodeJS.Timeout | undefined;
    try {
      return await Promise.race([
        Promise.resolve(check(requestId)).catch(() => false),
        new Promise<boolean>((resolve) => {
          timer = setTimeout(() => resolve(false), PUBLICATION_CHECK_TIMEOUT_MS);
        }),
      ]);
    } catch {
      return false;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  private async checkDuration(
    check: (requestId: string) => Promise<number> | number,
  ): Promise<number> {
    const requestId = this.options.requestId;
    if (!requestId || !check) return 0;

    let timer: NodeJS.Timeout | undefined;
    try {
      const value = await Promise.race([
        Promise.resolve(check(requestId)).catch(() => 0),
        new Promise<number>((resolve) => {
          timer = setTimeout(() => resolve(0), PUBLICATION_CHECK_TIMEOUT_MS);
        }),
      ]);
      return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;
    } catch {
      return 0;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}
