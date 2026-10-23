export type DiceRoll = {
  id: string;
  label: string;
  notation: string;
  status: 'rolling' | 'complete' | 'failed';
  total?: number;
  dice?: number[];
  modifier?: number;
  mode?: 'normal' | 'advantage' | 'disadvantage' | 'reported';
};

type RollView = {
  label: HTMLElement;
  notation: HTMLElement;
  total: HTMLElement;
  breakdown: HTMLElement;
  dismiss: HTMLButtonElement;
  panel: HTMLElement;
  announcement: HTMLElement;
};

/** Presents only rolls first observed after a campaign is opened. It never generates or changes dice. */
export class DiceFeedback {
  private seen = new Set<string>();
  private rolls = new Map<string, DiceRoll>();
  private statuses = new Map<string, DiceRoll['status']>();
  private queue: string[] = [];
  private queued = new Set<string>();
  private manualDismissed = new Set<string>();
  private unavailable = new Set<string>();
  private active?: string;
  private timer?: number;
  private interval?: number;
  private dismissed = false;
  private generation = 0;
  private resolving = false;
  private finalized = false;

  constructor(
    private view: RollView,
    private reducedMotion: () => boolean,
  ) {
    view.dismiss.addEventListener('click', () => {
      this.dismissed = true;
      if (this.active) this.manualDismissed.add(this.active);
      for (const id of this.queue) this.manualDismissed.add(id);
      this.clearTimer();
      this.active = undefined;
      this.queue = [];
      this.queued.clear();
      view.panel.hidden = true;
    });
  }

  reset(rolls: DiceRoll[] = []) {
    this.cancel();
    this.seen = new Set(rolls.map((roll) => roll.id));
    this.rolls.clear();
    this.statuses.clear();
    this.queued.clear();
    this.manualDismissed.clear();
    this.unavailable.clear();
    for (const roll of rolls) {
      this.rolls.set(roll.id, roll);
      this.statuses.set(roll.id, roll.status);
    }
    this.dismissed = false;
    this.resolving = false;
    this.view.panel.hidden = true;
  }

  observe(rolls: DiceRoll[] = [], resolving: boolean) {
    this.resolving = resolving;
    for (const roll of rolls) {
      const previousStatus = this.statuses.get(roll.id);
      this.rolls.set(roll.id, roll);
      this.statuses.set(roll.id, roll.status);
      if (!this.seen.has(roll.id)) {
        this.seen.add(roll.id);
        this.queue.push(roll.id);
        this.queued.add(roll.id);
        this.dismissed = false;
      } else if (
        previousStatus === 'failed' &&
        roll.status === 'rolling' &&
        !this.manualDismissed.has(roll.id)
      ) {
        this.unavailable.delete(roll.id);
        if (this.active === roll.id) {
          this.clearTimer();
          this.finalized = false;
          this.view.total.textContent = '…';
          this.view.breakdown.textContent = '';
          this.view.announcement.textContent = '';
          this.view.total.classList.toggle(
            'rolling',
            !this.reducedMotion() && roll.mode !== 'reported',
          );
          if (!this.reducedMotion() && roll.mode !== 'reported') this.animate(this.generation);
          this.timer = window.setTimeout(
            () => this.finishAnimation(this.generation),
            this.reducedMotion() || roll.mode === 'reported' ? 0 : 900,
          );
        } else {
          this.enqueue(roll.id);
        }
      } else if (
        previousStatus !== 'complete' &&
        roll.status === 'complete' &&
        this.unavailable.has(roll.id)
      ) {
        if (this.active === roll.id && this.finalized) {
          this.clearTimer();
          this.unavailable.delete(roll.id);
          this.finalized = false;
          this.finishAnimation(this.generation);
        } else if (!this.manualDismissed.has(roll.id)) {
          this.unavailable.delete(roll.id);
          this.enqueue(roll.id);
        }
      }
    }
    if (!resolving && this.active) {
      const active = this.rolls.get(this.active);
      if (!this.finalized && active?.status !== 'rolling') this.finishAnimation(this.generation);
      else if (!this.finalized && active?.status === 'rolling')
        this.showUnavailable(this.generation);
      return;
    }
    this.playNext();
  }

  cancel() {
    this.generation++;
    this.clearTimer();
    if (this.interval !== undefined) window.clearInterval(this.interval);
    this.interval = undefined;
    this.active = undefined;
    this.queue = [];
    this.queued.clear();
    this.view.panel.hidden = true;
  }

  private playNext(): void {
    if (this.dismissed || this.active || !this.queue.length) return;
    const id = this.queue.shift()!;
    this.queued.delete(id);
    const roll = this.rolls.get(id);
    if (!roll) return this.playNext();
    this.active = id;
    this.finalized = false;
    const generation = ++this.generation;
    this.view.panel.hidden = false;
    this.view.label.textContent = roll.label || 'Dice roll';
    this.view.notation.textContent = roll.notation;
    this.view.breakdown.textContent = '';
    this.view.announcement.textContent = '';
    this.view.total.textContent = '…';
    this.view.total.setAttribute('aria-hidden', 'true');
    this.view.total.classList.toggle('rolling', !this.reducedMotion() && roll.mode !== 'reported');
    this.view.total.setAttribute('aria-label', 'Rolling');
    if (!this.reducedMotion() && roll.mode !== 'reported') this.animate(generation);
    const delay = this.reducedMotion() || roll.mode === 'reported' ? 0 : 900;
    this.timer = window.setTimeout(() => this.finishAnimation(generation), delay);
  }

  private animate(generation: number) {
    this.interval = window.setInterval(() => {
      if (generation !== this.generation || !this.active) return;
      const notation = this.rolls.get(this.active)?.notation ?? '';
      const sides = Number(notation.match(/d(\d+)/i)?.[1] ?? 20);
      this.view.total.textContent = String(1 + Math.floor(Math.random() * Math.max(1, sides)));
    }, 65);
  }

  private finishAnimation(generation: number) {
    if (generation !== this.generation || !this.active) return;
    if (this.timer !== undefined) window.clearTimeout(this.timer);
    this.timer = undefined;
    const roll = this.rolls.get(this.active);
    if (!roll || roll.status === 'rolling') {
      if (!this.resolving) return this.showUnavailable(generation);
      this.timer = window.setTimeout(() => this.finishAnimation(generation), 160);
      return;
    }
    this.clearTimer();
    this.view.total.classList.remove('rolling');
    if (roll.status === 'failed' || typeof roll.total !== 'number') {
      this.view.total.textContent = 'Unavailable';
      this.view.total.setAttribute('aria-label', 'Roll result unavailable');
      this.view.breakdown.textContent = 'The roll did not produce a saved result.';
      this.view.announcement.textContent = `${roll.label || 'Dice roll'} result unavailable.`;
      this.unavailable.add(roll.id);
    } else {
      this.view.total.textContent = String(roll.total);
      this.view.total.setAttribute('aria-label', `Total ${roll.total}`);
      if (roll.mode === 'reported') {
        this.view.breakdown.textContent = `Recorded roll${roll.dice?.length ? ` · ${roll.dice.join(', ')}` : ''}`;
      } else if (roll.mode === 'advantage' || roll.mode === 'disadvantage') {
        this.view.breakdown.textContent = `${roll.mode === 'advantage' ? 'Advantage' : 'Disadvantage'} · ${roll.dice?.join(' / ') ?? ''}${(roll.modifier ?? 0) ? ` ${roll.modifier! > 0 ? '+' : '−'} ${Math.abs(roll.modifier!)}` : ''} = ${roll.total}`;
      } else {
        const dice = roll.dice?.length ? roll.dice.join(' + ') : '';
        const modifier =
          (roll.modifier ?? 0) > 0
            ? ` + ${roll.modifier}`
            : (roll.modifier ?? 0) < 0
              ? ` − ${Math.abs(roll.modifier!)}`
              : '';
        this.view.breakdown.textContent = dice
          ? `${dice}${modifier} = ${roll.total}`
          : `Saved total: ${roll.total}`;
      }
      this.view.announcement.textContent = `${roll.label || 'Dice roll'}: ${roll.total}. ${this.view.breakdown.textContent}`;
    }
    this.holdThenNext(generation);
    this.finalized = true;
  }

  private showUnavailable(generation: number) {
    this.clearTimer();
    this.view.total.classList.remove('rolling');
    this.view.total.textContent = 'Unavailable';
    this.view.total.setAttribute('aria-label', 'Roll result unavailable');
    this.view.breakdown.textContent =
      'No saved result has been confirmed. Check with the DM before trying again.';
    this.view.announcement.textContent = `${this.view.label.textContent || 'Dice roll'} result unavailable.`;
    if (this.active) this.unavailable.add(this.active);
    this.holdThenNext(generation);
    this.finalized = true;
  }

  private holdThenNext(generation: number) {
    this.timer = window.setTimeout(() => {
      if (generation !== this.generation) return;
      this.active = undefined;
      this.view.panel.hidden = true;
      this.playNext();
    }, 1100);
  }

  private clearTimer() {
    if (this.timer !== undefined) window.clearTimeout(this.timer);
    this.timer = undefined;
    if (this.interval !== undefined) window.clearInterval(this.interval);
    this.interval = undefined;
  }

  private enqueue(id: string) {
    if (this.queued.has(id) || this.manualDismissed.has(id)) return;
    this.queued.add(id);
    this.queue.push(id);
    this.dismissed = false;
    this.playNext();
  }
}
