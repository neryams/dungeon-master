import type {
  SpeechSettingsState,
  SpeechVoice,
  SpeechTextResult,
  SpeechResult,
  TranscriptionInput,
} from './contracts.js';

interface Credentials {
  status(): Promise<{ configured: boolean; unreadable: boolean }>;
  load(): Promise<string | null>;
  save(key: string): Promise<void>;
  remove(): Promise<void>;
}
interface Engine {
  synthesize(key: string, text: string, voice: string, signal?: AbortSignal): Promise<string>;
  transcribe(key: string, audio: string, mimeType: string, signal?: AbortSignal): Promise<string>;
}
/** Main-process speech lifecycle. Neither keys nor raw provider errors cross the bridge. */
export class SpeechService {
  private generation = 0;
  private tested = false;
  private changing = false;
  private narration?: AbortController;
  private transcriptions = new Map<number, AbortController>();
  private recording = new Set<number>();
  private recordingIntents = new Map<number, number>();
  constructor(
    private credentials: Credentials,
    private engine: Engine,
    private notify: (state: SpeechSettingsState) => void,
    private recordingChanged: (active: boolean) => void,
  ) {}

  async settings(): Promise<SpeechSettingsState> {
    const state = await this.credentials.status();
    return {
      configured: state.configured,
      available: state.configured && !state.unreadable && !this.changing,
      tested: this.tested && !state.unreadable,
      detail: state.unreadable
        ? 'The saved Gemini key could not be unlocked. Unlock your system keychain and retry.'
        : state.configured
          ? this.tested
            ? 'API key saved. Speech successfully tested.'
            : 'API key saved. Use Test voice to check access.'
          : 'Add a Gemini API key to enable narration and dictation.',
    };
  }
  private async changed() {
    const state = await this.settings();
    this.notify(state);
    return state;
  }
  async save(key: string) {
    return this.change(() => this.credentials.save(key));
  }
  async remove() {
    return this.change(() => this.credentials.remove());
  }
  private async change(action: () => Promise<void>) {
    if (this.changing) throw new Error('Speech settings are being saved. Try again shortly.');
    this.changing = true;
    this.cancelAll();
    try {
      await this.changed();
      await action();
      this.tested = false;
    } finally {
      this.changing = false;
      await this.changed();
    }
    return this.settings();
  }
  cancelSpeech() {
    this.narration?.abort();
    this.narration = undefined;
  }
  cancelTranscription(owner: number) {
    this.transcriptions.get(owner)?.abort();
    this.transcriptions.delete(owner);
  }
  cancelOwner(owner: number) {
    this.recordingIntents.set(owner, (this.recordingIntents.get(owner) ?? 0) + 1);
    this.cancelTranscription(owner);
    this.recording.delete(owner);
    this.recordingChanged(this.recording.size > 0);
  }
  cancelAll() {
    ++this.generation;
    this.cancelSpeech();
    for (const controller of this.transcriptions.values()) controller.abort();
    this.transcriptions.clear();
    this.recording.clear();
    this.recordingChanged(false);
  }
  async setRecording(owner: number, active: boolean) {
    const intent = (this.recordingIntents.get(owner) ?? 0) + 1;
    this.recordingIntents.set(owner, intent);
    if (active) {
      const generation = this.generation;
      const state = await this.settings();
      if (intent !== this.recordingIntents.get(owner) || generation !== this.generation) return;
      if (!state.available) throw new Error('Set up Gemini speech before recording.');
      if (this.recording.size && !this.recording.has(owner))
        throw new Error('Another player is recording. Wait until they finish.');
      this.cancelSpeech();
      this.recording.add(owner);
    } else this.recording.delete(owner);
    this.recordingChanged(this.recording.size > 0);
  }
  async speak(
    voice: SpeechVoice,
    resolveText: () => Promise<SpeechTextResult>,
  ): Promise<SpeechResult> {
    if (this.recording.size) throw new Error('Narration is paused while a player records.');
    this.cancelSpeech();
    const controller = new AbortController();
    this.narration = controller;
    const generation = this.generation;
    try {
      const key = await this.key();
      this.current(controller, generation);
      const part = await resolveText();
      this.current(controller, generation);
      const audio = part.text
        ? await this.engine.synthesize(key, part.text, voice, controller.signal)
        : '';
      this.current(controller, generation);
      if (audio) {
        this.tested = true;
        await this.changed();
      }
      this.current(controller, generation);
      return { audio, ...(part.nextPart !== undefined ? { nextPart: part.nextPart } : {}) };
    } finally {
      if (this.narration === controller) this.narration = undefined;
    }
  }
  async transcribe(owner: number, input: TranscriptionInput) {
    if (this.transcriptions.has(owner))
      throw new Error('Wait for the current transcription or cancel it.');
    const controller = new AbortController();
    this.transcriptions.set(owner, controller);
    const generation = this.generation;
    try {
      const key = await this.key();
      this.current(controller, generation);
      const text = await this.engine.transcribe(
        key,
        input.audio,
        input.mimeType,
        controller.signal,
      );
      this.current(controller, generation);
      this.tested = true;
      await this.changed();
      this.current(controller, generation);
      return { text };
    } finally {
      if (this.transcriptions.get(owner) === controller) this.transcriptions.delete(owner);
    }
  }
  private current(controller: AbortController, generation: number) {
    if (controller.signal.aborted || generation !== this.generation)
      throw new Error('Speech cancelled.');
  }
  private async key() {
    if (this.changing) throw new Error('Speech settings are being saved.');
    const key = await this.credentials.load();
    if (!key) throw new Error('Add a Gemini API key in Speech settings.');
    return key;
  }
}
