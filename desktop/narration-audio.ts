// Audio stays in the sandboxed renderer. No filesystem URLs or network requests.
export class NarrationAudio {
  private context?: AudioContext;
  private source?: AudioBufferSourceNode;
  private finish?: () => void;
  private generation = 0;

  stop() {
    ++this.generation;
    const source = this.source;
    this.source = undefined;
    if (source) {
      source.onended = null;
      try {
        source.stop();
      } catch {
        /* Already stopped or not started. */
      }
      source.disconnect();
    }
    this.finish?.();
    this.finish = undefined;
  }

  async play(base64: string): Promise<void> {
    this.stop();
    if (!base64) return;
    const generation = this.generation;
    const context = (this.context ??= new AudioContext());
    const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
    const buffer = await context.decodeAudioData(bytes.buffer);
    if (generation !== this.generation) return;
    await context.resume();
    if (generation !== this.generation) return;
    return new Promise<void>((resolve, reject) => {
      const source = context.createBufferSource();
      source.buffer = buffer;
      source.connect(context.destination);
      this.source = source;
      this.finish = resolve;
      source.onended = () => {
        source.disconnect();
        if (this.source === source) {
          this.source = undefined;
          this.finish = undefined;
        }
        resolve();
      };
      try {
        source.start();
      } catch (error) {
        this.finish = undefined;
        this.stop();
        reject(error);
      }
    });
  }

  close() {
    this.stop();
    void this.context?.close();
  }
}
