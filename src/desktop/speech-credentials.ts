import { randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, unlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';

export interface SpeechCryptoAdapter {
  encryptString(value: string): Buffer | Uint8Array | Promise<Buffer | Uint8Array>;
  decryptString(value: Buffer): string | Promise<string>;
}

export interface SpeechCredentialStatus {
  configured: boolean;
  unreadable: boolean;
}

/** Stores only OS-encrypted API keys in an atomic, owner-only file. */
export class SpeechCredentials {
  constructor(
    private readonly path: string,
    private readonly crypto: SpeechCryptoAdapter,
  ) {}

  async status(): Promise<SpeechCredentialStatus> {
    try {
      const key = await this.load();
      return { configured: key !== null, unreadable: false };
    } catch {
      return { configured: true, unreadable: true };
    }
  }

  async load(): Promise<string | null> {
    let text: string;
    try {
      text = await readFile(this.path, 'utf8');
    } catch (error) {
      if (isMissing(error)) return null;
      throw new Error('Stored speech credentials are unreadable.');
    }
    try {
      const parsed: unknown = JSON.parse(text);
      if (
        typeof parsed !== 'object' ||
        parsed === null ||
        Array.isArray(parsed) ||
        (parsed as Record<string, unknown>).version !== 1 ||
        typeof (parsed as Record<string, unknown>).encrypted !== 'string'
      )
        throw new Error();
      const encrypted = Buffer.from((parsed as { encrypted: string }).encrypted, 'base64');
      if (
        !encrypted.length ||
        encrypted.toString('base64') !== (parsed as { encrypted: string }).encrypted
      )
        throw new Error();
      const key = await this.crypto.decryptString(encrypted);
      if (
        typeof key !== 'string' ||
        key.length < 10 ||
        key.length > 512 ||
        !/^[A-Za-z0-9_-]+$/.test(key)
      )
        throw new Error();
      return key;
    } catch {
      throw new Error('Stored speech credentials are unreadable.');
    }
  }

  async save(key: string): Promise<void> {
    if (
      typeof key !== 'string' ||
      key.length < 10 ||
      key.length > 512 ||
      !/^[A-Za-z0-9_-]+$/.test(key)
    )
      throw new Error('Gemini API key is invalid.');
    let encrypted: Buffer;
    try {
      encrypted = Buffer.from(await this.crypto.encryptString(key));
    } catch {
      throw new Error('Could not encrypt speech credentials on this device.');
    }
    if (!encrypted.length) throw new Error('Could not encrypt speech credentials on this device.');
    const document = JSON.stringify({ version: 1, encrypted: encrypted.toString('base64') });
    const parent = dirname(this.path);
    const temporary = join(parent, `.${randomUUID()}.tmp`);
    let handle: Awaited<ReturnType<typeof open>> | undefined;
    try {
      await mkdir(parent, { recursive: true, mode: 0o700 });
      handle = await open(temporary, 'wx', 0o600);
      await handle.writeFile(document, 'utf8');
      await handle.sync();
      await handle.close();
      handle = undefined;
      await rename(temporary, this.path);
    } catch {
      await handle?.close().catch(() => undefined);
      await unlink(temporary).catch(() => undefined);
      throw new Error('Could not save speech credentials.');
    }
  }

  async remove(): Promise<void> {
    try {
      await unlink(this.path);
    } catch (error) {
      if (!isMissing(error)) throw new Error('Could not remove speech credentials.');
    }
  }
}

function isMissing(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
}
