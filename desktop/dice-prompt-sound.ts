/** A quiet notification cue, independent of narration and campaign state. */
export class DicePromptSound {
  private context?: AudioContext;
  private seen = new Set<string>();

  // Browsers require an interaction before allowing audio. Never queue an old ping.
  unlock() {
    try {
      this.context ??= new AudioContext();
      if (this.context.state === 'suspended') void this.context.resume().catch(() => {});
    } catch {
      // Audio availability must not interfere with the dice prompt.
    }
  }

  observe(campaignId: string, promptId?: string) {
    if (!promptId) return;
    const key = JSON.stringify([campaignId, promptId]);
    if (this.seen.has(key)) return;
    this.seen.add(key);
    try {
      const context = (this.context ??= new AudioContext());
      if (context.state !== 'running') return;
      const tone = context.createOscillator();
      const volume = context.createGain();
      const now = context.currentTime;
      tone.type = 'sine';
      tone.frequency.setValueAtTime(880, now);
      volume.gain.setValueAtTime(0, now);
      volume.gain.linearRampToValueAtTime(0.12, now + 0.008);
      volume.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
      tone.connect(volume);
      volume.connect(context.destination);
      tone.onended = () => {
        tone.disconnect();
        volume.disconnect();
      };
      tone.start(now);
      tone.stop(now + 0.22);
    } catch {
      // Muted or unsupported audio leaves the visible prompt fully usable.
    }
  }
}
