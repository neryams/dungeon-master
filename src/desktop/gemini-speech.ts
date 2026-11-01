import { Buffer } from 'node:buffer';

const API_ORIGIN = 'https://generativelanguage.googleapis.com';
const API_ROOT = `${API_ORIGIN}/upload/v1beta/files`;
const INTERACTIONS = `${API_ORIGIN}/v1beta/interactions`;
const MAX_AUDIO_BYTES = 10 * 1024 * 1024;
const MAX_TEXT = 20_000;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const MAX_TTS_RESPONSE_BYTES = 14 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 120_000;

export type GeminiSpeechErrorCode =
  | 'invalid_input'
  | 'invalid_key'
  | 'quota'
  | 'access_denied'
  | 'model_unavailable'
  | 'cleanup_failed'
  | 'file_processing_failed'
  | 'network'
  | 'timeout'
  | 'http'
  | 'invalid_response'
  | 'cancelled';

/** Safe-to-display failure categories; upstream response bodies are never included. */
export class GeminiSpeechError extends Error {
  constructor(readonly code: GeminiSpeechErrorCode) {
    super(messageFor(code));
    this.name = 'GeminiSpeechError';
  }
}

function messageFor(code: GeminiSpeechErrorCode): string {
  switch (code) {
    case 'invalid_input':
      return 'Speech input is invalid or exceeds the supported size.';
    case 'invalid_key':
      return 'Gemini API key was rejected.';
    case 'quota':
      return 'Gemini speech quota has been reached.';
    case 'access_denied':
      return 'Gemini speech access was denied.';
    case 'model_unavailable':
      return 'The requested Gemini speech model is unavailable.';
    case 'cleanup_failed':
      return 'Gemini could not remove the temporary audio file.';
    case 'file_processing_failed':
      return 'Gemini could not process the uploaded audio file.';
    case 'network':
      return 'Could not reach the Gemini speech service.';
    case 'timeout':
      return 'Gemini speech request timed out.';
    case 'http':
      return 'Gemini speech request failed.';
    case 'invalid_response':
      return 'Gemini returned an unsupported speech response.';
    case 'cancelled':
      return 'Speech request was cancelled.';
  }
}

export interface GeminiSpeechOptions {
  fetch?: typeof fetch;
  timeoutMs?: number;
}

type JsonObject = Record<string, unknown>;

/** REST adapter for Gemini TTS and file-backed transcription. Audio stays in memory. */
export class GeminiSpeech {
  private readonly fetcher: typeof fetch;
  private readonly timeoutMs: number;

  constructor(options: GeminiSpeechOptions = {}) {
    this.fetcher = options.fetch ?? fetch;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async synthesize(
    key: string,
    text: string,
    voice: string,
    signal?: AbortSignal,
  ): Promise<string> {
    validateKey(key);
    if (
      typeof text !== 'string' ||
      !text.trim() ||
      text.length > MAX_TEXT ||
      typeof voice !== 'string' ||
      !/^[\w -]{1,64}$/.test(voice)
    )
      fail('invalid_input');
    const result = await this.request(
      INTERACTIONS,
      key,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          model: 'gemini-3.8-flash-tts',
          store: false,
          input: [{ type: 'user_input', content: [{ type: 'text', text }] }],
          response_format: { type: 'audio', mime_type: 'audio/wav' },
          generation_config: { speech_config: [{ voice }] },
        }),
      },
      signal,
      false,
      false,
      MAX_TTS_RESPONSE_BYTES,
    );
    const data = findAudio(result.json);
    if (
      typeof data !== 'string' ||
      data.length > Math.ceil((MAX_AUDIO_BYTES * 4) / 3) + 8 ||
      !isBase64(data)
    )
      fail('invalid_response');
    const bytes = Buffer.from(data, 'base64');
    validateWav(bytes);
    return bytes.toString('base64');
  }

  async transcribe(
    key: string,
    audio: string,
    mimeType: string,
    signal?: AbortSignal,
  ): Promise<string> {
    validateKey(key);
    if (
      typeof audio !== 'string' ||
      !audio ||
      audio.length > Math.ceil((MAX_AUDIO_BYTES * 4) / 3) + 8 ||
      !isBase64(audio) ||
      !/^audio\/[a-z0-9.+-]{1,64}$/i.test(mimeType)
    )
      fail('invalid_input');
    const bytes = Buffer.from(audio, 'base64');
    if (!bytes.length || bytes.length > MAX_AUDIO_BYTES) fail('invalid_input');

    let resource: string | undefined;
    let transcript: string | undefined;
    const deadline = Date.now() + this.timeoutMs;
    try {
      const start = await this.request(
        API_ROOT,
        key,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-goog-upload-protocol': 'resumable',
            'x-goog-upload-command': 'start',
            'x-goog-upload-header-content-length': String(bytes.length),
            'x-goog-upload-header-content-type': mimeType,
          },
          body: JSON.stringify({ file: { display_name: 'dungeon-master-audio' } }),
        },
        signal,
        true,
        false,
        MAX_RESPONSE_BYTES,
        deadline,
      );
      const uploadUrl = start.headers.get('x-goog-upload-url');
      if (!uploadUrl || !isTrustedUrl(uploadUrl)) fail('invalid_response');
      const uploaded = await this.request(
        uploadUrl,
        key,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/octet-stream',
            'content-length': String(bytes.length),
            'x-goog-upload-offset': '0',
            'x-goog-upload-command': 'upload, finalize',
          },
          body: bytes,
        },
        signal,
        false,
        true,
        MAX_RESPONSE_BYTES,
        deadline,
      );
      const file = isObject(uploaded.json) ? uploaded.json.file : undefined;
      const name = isObject(file) ? file.name : undefined;
      if (typeof name !== 'string' || !/^files\/[A-Za-z0-9_-]{1,200}$/.test(name))
        fail('invalid_response');
      resource = name;
      let uri = isObject(file) ? file.uri : undefined;
      if (typeof uri !== 'string' || !isTrustedUrl(uri)) fail('invalid_response');
      let state = isObject(file) && typeof file.state === 'string' ? file.state : undefined;
      while (state === 'PROCESSING') {
        await delayAbortable(Math.min(500, Math.max(1, deadline - Date.now())), signal, deadline);
        const metadata = await this.request(
          `${API_ORIGIN}/v1beta/${resource}`,
          key,
          {
            method: 'GET',
          },
          signal,
          false,
          false,
          MAX_RESPONSE_BYTES,
          deadline,
        );
        const current = metadata.json;
        if (
          !isObject(current) ||
          current.name !== resource ||
          typeof current.uri !== 'string' ||
          !isTrustedUrl(current.uri)
        )
          fail('invalid_response');
        uri = current.uri;
        state = typeof current.state === 'string' ? current.state : undefined;
        if (state === 'FAILED') fail('file_processing_failed');
        if (state !== 'PROCESSING' && state !== 'ACTIVE') fail('invalid_response');
      }
      if (state === 'FAILED') fail('file_processing_failed');
      const interaction = await this.request(
        INTERACTIONS,
        key,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            model: 'gemini-3.5-transcribe',
            store: false,
            input: [{ type: 'audio', uri, mime_type: mimeType }],
            generation_config: { transcription_config: { mode: 'verbatim' } },
          }),
        },
        signal,
        false,
        false,
        MAX_RESPONSE_BYTES,
        deadline,
      );
      const extracted = findText(interaction.json);
      if (typeof extracted !== 'string' || extracted.length > MAX_TEXT) fail('invalid_response');
      transcript = extracted;
    } finally {
      if (resource) await this.deleteFile(key, resource);
    }
    return transcript!;
  }

  private async deleteFile(key: string, resource: string): Promise<void> {
    try {
      // Use a fresh timeout signal so caller cancellation cannot skip remote cleanup.
      const response = await this.fetcher(`${API_ORIGIN}/v1beta/${resource}`, {
        method: 'DELETE',
        headers: { 'x-goog-api-key': key },
        redirect: 'error',
        signal: AbortSignal.timeout(Math.min(this.timeoutMs, 10_000)),
      });
      if (!response.ok) fail('cleanup_failed');
    } catch (error) {
      if (error instanceof GeminiSpeechError) throw error;
      fail('cleanup_failed');
    }
  }

  private async request(
    url: string,
    key: string,
    init: RequestInit,
    callerSignal?: AbortSignal,
    noJson = false,
    rawBytes = false,
    maxResponseBytes = MAX_RESPONSE_BYTES,
    deadline?: number,
  ): Promise<{ headers: Headers; json: unknown }> {
    if (callerSignal?.aborted) fail('cancelled');
    const controller = new AbortController();
    const remaining =
      deadline === undefined ? this.timeoutMs : Math.min(this.timeoutMs, deadline - Date.now());
    if (remaining <= 0) fail('timeout');
    const timer = setTimeout(() => controller.abort('timeout'), remaining);
    const onAbort = () => controller.abort('caller');
    callerSignal?.addEventListener('abort', onAbort, { once: true });
    if (callerSignal?.aborted) onAbort();
    try {
      const headers = new Headers(init.headers);
      headers.set('x-goog-api-key', key);
      const response = await this.fetcher(url, {
        ...init,
        headers,
        redirect: 'error',
        signal: controller.signal,
      });
      if (callerSignal?.aborted) fail('cancelled');
      if (!response.ok) {
        const category = await classifyHttpError(response);
        fail(category);
      }
      if (noJson) {
        await response.body?.cancel().catch(() => undefined);
        return { headers: response.headers, json: undefined };
      }
      const body = rawBytes
        ? await readBytes(response, maxResponseBytes)
        : await readText(response, maxResponseBytes);
      let json: unknown;
      try {
        json = JSON.parse(
          rawBytes ? Buffer.from(body as Uint8Array).toString('utf8') : (body as string),
        );
      } catch {
        fail('invalid_response');
      }
      if (callerSignal?.aborted) fail('cancelled');
      return { headers: response.headers, json };
    } catch (error) {
      if (error instanceof GeminiSpeechError) throw error;
      if (callerSignal?.aborted) fail('cancelled');
      if (controller.signal.aborted) fail('timeout');
      return fail('network');
    } finally {
      clearTimeout(timer);
      callerSignal?.removeEventListener('abort', onAbort);
    }
  }
}

function delayAbortable(
  ms: number,
  signal: AbortSignal | undefined,
  deadline: number,
): Promise<void> {
  if (signal?.aborted) return Promise.reject(new GeminiSpeechError('cancelled'));
  if (Date.now() >= deadline) return Promise.reject(new GeminiSpeechError('timeout'));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(done, ms);
    const onAbort = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      reject(new GeminiSpeechError('cancelled'));
    };
    function done() {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function fail(code: GeminiSpeechErrorCode): never {
  throw new GeminiSpeechError(code);
}
function isBase64(value: string): boolean {
  if (value.length % 4 !== 0) return false;
  return Buffer.from(value, 'base64').toString('base64') === value;
}
function validateKey(key: string): void {
  if (
    typeof key !== 'string' ||
    key.length < 10 ||
    key.length > 512 ||
    !/^[A-Za-z0-9_-]+$/.test(key)
  )
    fail('invalid_input');
}
async function classifyHttpError(response: Response): Promise<GeminiSpeechErrorCode> {
  if (response.status === 401) return 'invalid_key';
  if (response.status === 403) return 'access_denied';
  if (response.status === 404) return 'model_unavailable';
  if (response.status === 429) return 'quota';
  if (response.status === 400) {
    try {
      const text = await readText(response, 16 * 1024);
      const parsed: unknown = JSON.parse(text);
      if (isObject(parsed) && isObject(parsed.error)) {
        const error = parsed.error;
        const status = typeof error.status === 'string' ? error.status : '';
        const message = typeof error.message === 'string' ? error.message : '';
        const details = Array.isArray(error.details) ? JSON.stringify(error.details) : '';
        if (
          /API_KEY_INVALID|API key not valid|invalid api key/i.test(
            `${status} ${message} ${details}`,
          )
        )
          return 'invalid_key';
      }
    } catch {
      /* return the generic safe HTTP category */
    }
  }
  return 'http';
}
function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function isTrustedUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.origin === API_ORIGIN && !url.username && !url.password;
  } catch {
    return false;
  }
}
async function readText(response: Response, max: number): Promise<string> {
  const bytes = await readBytes(response, max);
  return Buffer.from(bytes).toString('utf8');
}
async function readBytes(response: Response, max: number): Promise<Uint8Array> {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > max) fail('invalid_response');
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel();
      fail('invalid_response');
    }
    chunks.push(value);
  }
  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}
function findAudio(value: unknown): unknown {
  if (!isObject(value) || !Array.isArray(value.steps)) return undefined;
  for (let i = value.steps.length - 1; i >= 0; i--) {
    const step = value.steps[i];
    if (!isObject(step) || step.type !== 'model_output' || !Array.isArray(step.content)) continue;
    for (let j = step.content.length - 1; j >= 0; j--) {
      const part = step.content[j];
      if (isObject(part) && part.type === 'audio') return part.data;
    }
  }
  return undefined;
}
function findText(value: unknown): unknown {
  if (!isObject(value)) return undefined;
  if (typeof value.output_text === 'string') return value.output_text;
  if (!Array.isArray(value.steps)) return undefined;
  const parts: string[] = [];
  for (const step of value.steps) {
    if (isObject(step) && step.type === 'model_output' && Array.isArray(step.content))
      for (const part of step.content) {
        if (isObject(part) && part.type === 'text' && typeof part.text === 'string')
          parts.push(part.text);
      }
  }
  return parts.length ? parts.join('') : undefined;
}
function validateWav(data: Buffer): void {
  if (
    data.length < 44 ||
    data.length > MAX_AUDIO_BYTES ||
    data.toString('ascii', 0, 4) !== 'RIFF' ||
    data.toString('ascii', 8, 12) !== 'WAVE' ||
    data.readUInt32LE(4) !== data.length - 8
  )
    fail('invalid_response');
  let offset = 12;
  let format = false;
  let audio = false;
  while (offset + 8 <= data.length) {
    const id = data.toString('ascii', offset, offset + 4);
    const size = data.readUInt32LE(offset + 4);
    const start = offset + 8;
    if (size > data.length - start) fail('invalid_response');
    if (id === 'fmt ') {
      if (size < 16 || data.readUInt16LE(start) !== 1) fail('invalid_response');
      const channels = data.readUInt16LE(start + 2);
      const rate = data.readUInt32LE(start + 4);
      const bits = data.readUInt16LE(start + 14);
      if (!channels || channels > 2 || !rate || ![8, 16, 24, 32].includes(bits))
        fail('invalid_response');
      format = true;
    }
    if (id === 'data') {
      if (!size) fail('invalid_response');
      audio = true;
    }
    offset = start + size + (size & 1);
  }
  if (offset !== data.length || !format || !audio) fail('invalid_response');
}
