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
  isAwaitingPlayerRoll?: (requestId: string) => Promise<boolean>;
  hasPublishedResponse?: (requestId: string) => Promise<boolean>;
  onFinishingGrace?: () => void;
  onTimeout: () => void;
}

/** Bounds provider turns, allowing one cleanup window after a saved final response. */
export class TurnDeadline {
  private timer?: NodeJS.Timeout;
  private cancelled = false;
  private graceGranted = false;

  constructor(private readonly options: TurnDeadlineOptions) {}

  start(): void {
    if (this.cancelled || this.timer) return;
    this.timer = setTimeout(
      () => {
        this.timer = undefined;
        void this.expire();
      },
      Math.max(0, this.options.timeoutMs),
    );
  }

  cancel(): void {
    this.cancelled = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
  }

  private async expire(): Promise<void> {
    if (this.cancelled) return;
    if (this.options.requestId && this.options.isAwaitingPlayerRoll) {
      const waiting = await this.check(this.options.isAwaitingPlayerRoll);
      if (this.cancelled) return;
      if (waiting) {
        this.start();
        return;
      }
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
}
