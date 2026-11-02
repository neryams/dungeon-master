export interface DictationApi {
  transcribe(input: { audio: string; mimeType: 'audio/webm' }): Promise<{ text: string }>;
  cancelTranscription(): Promise<void>;
  setRecording(active: boolean): Promise<void>;
}

export interface DictationOptions {
  api: DictationApi;
  mediaDevices?: Pick<MediaDevices, 'getUserMedia'>;
  recorderFactory?: (stream: MediaStream) => MediaRecorder;
  onState(state: DictationState): void;
  append(text: string): void;
  contextKey?(): string;
  maxDurationMs?: number;
  maxBytes?: number;
}

export interface DictationState {
  status: 'idle' | 'requesting' | 'recording' | 'transcribing' | 'error';
  error?: string;
}

const MAX_DURATION = 120_000;
const MAX_BYTES = 10 * 1024 * 1024;

/** Owns microphone lifetime and transcription cancellation for one composer. */
export class DictationController {
  private readonly options: DictationOptions;
  private readonly mediaDevices: Pick<MediaDevices, 'getUserMedia'>;
  private readonly recorderFactory: (stream: MediaStream) => MediaRecorder;
  private readonly maxDurationMs: number;
  private readonly maxBytes: number;
  private state: DictationState = { status: 'idle' };
  private generation = 0;
  private stream?: MediaStream;
  private recorder?: MediaRecorder;
  private chunks: Blob[] = [];
  private timer?: number;
  private bytes = 0;
  private startedInContext = '';

  constructor(options: DictationOptions) {
    this.options = options;
    this.mediaDevices = options.mediaDevices ?? navigator.mediaDevices;
    this.recorderFactory =
      options.recorderFactory ??
      ((stream) => new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' }));
    this.maxDurationMs = options.maxDurationMs ?? MAX_DURATION;
    this.maxBytes = options.maxBytes ?? MAX_BYTES;
  }

  getState(): DictationState {
    return { ...this.state };
  }

  async start(): Promise<void> {
    if (this.state.status !== 'idle' && this.state.status !== 'error') return;
    const token = ++this.generation;
    this.startedInContext = this.options.contextKey?.() ?? '';
    this.setState({ status: 'requesting', error: undefined });
    try {
      await this.options.api.setRecording(true);
      if (token !== this.generation) return;
      const stream = await this.mediaDevices.getUserMedia({ audio: true });
      if (token !== this.generation) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      this.stream = stream;
      this.chunks = [];
      this.bytes = 0;
      const recorder = this.recorderFactory(stream);
      this.recorder = recorder;
      recorder.ondataavailable = (event) => {
        if (token !== this.generation || !event.data.size) return;
        this.bytes += event.data.size;
        if (this.bytes > this.maxBytes) {
          void this.cancel('Recording exceeded 10 MB.');
          return;
        }
        this.chunks.push(event.data);
      };
      recorder.onerror = () => void this.cancel('Recording failed.');
      recorder.onstop = () => {
        if (token === this.generation) void this.finish(token);
      };
      recorder.start(1000);
      if (token !== this.generation) {
        this.release();
        return;
      }
      this.setState({ status: 'recording' });
      this.timer = window.setTimeout(() => void this.stop(), this.maxDurationMs);
    } catch (error) {
      if (token !== this.generation) return;
      this.release();
      await this.options.api.setRecording(false).catch(() => undefined);
      if (token !== this.generation) return;
      this.setState({
        status: 'error',
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async stop(): Promise<void> {
    if (this.state.status !== 'recording') return;
    this.clearTimer();
    try {
      this.recorder?.stop();
    } catch {
      await this.finish(this.generation);
    }
  }

  async cancel(error?: string): Promise<void> {
    const token = ++this.generation;
    this.clearTimer();
    try {
      if (this.recorder?.state === 'recording') this.recorder.stop();
    } catch {
      /* cleanup below */
    }
    this.release();
    this.chunks = [];
    this.bytes = 0;
    await Promise.allSettled([
      this.options.api.cancelTranscription(),
      this.options.api.setRecording(false),
    ]);
    if (token === this.generation)
      this.setState(error ? { status: 'error', error } : { status: 'idle' });
  }

  private async finish(token: number): Promise<void> {
    const chunks = this.chunks;
    const mimeType = 'audio/webm';
    const blob = new Blob(chunks, { type: mimeType });
    this.release();
    this.chunks = [];
    if (token !== this.generation) return;
    try {
      await this.options.api.setRecording(false);
      if (token !== this.generation) return;
      if (!blob.size) {
        this.setState({ status: 'idle' });
        return;
      }
      if (blob.size > this.maxBytes) {
        this.setState({ status: 'error', error: 'Recording exceeded 10 MB.' });
        return;
      }
      this.setState({ status: 'transcribing' });
      const audio = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(new Error('Could not read recorded audio.'));
        reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
        reader.readAsDataURL(blob);
      });
      if (token !== this.generation) return;
      if (this.startedInContext !== (this.options.contextKey?.() ?? '')) {
        await this.cancel();
        return;
      }
      const result = await this.options.api.transcribe({ audio, mimeType });
      if (
        token === this.generation &&
        this.startedInContext === (this.options.contextKey?.() ?? '') &&
        result.text.trim()
      )
        this.options.append(result.text.trim());
      if (token === this.generation) this.setState({ status: 'idle' });
    } catch (error) {
      if (token === this.generation)
        this.setState({
          status: 'error',
          error: error instanceof Error ? error.message : String(error),
        });
    }
  }

  private release(): void {
    this.clearTimer();
    this.recorder = undefined;
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = undefined;
  }
  private clearTimer(): void {
    if (this.timer !== undefined) window.clearTimeout(this.timer);
    this.timer = undefined;
  }
  private setState(state: DictationState): void {
    this.state = state;
    this.options.onState(this.getState());
  }
}
