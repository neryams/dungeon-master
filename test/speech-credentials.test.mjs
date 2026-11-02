import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { SpeechCredentials } from '../dist/desktop/speech-credentials.js';

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dm-speech-credentials-'));
  t.after(
    async () =>
      await import('node:fs/promises').then(({ rm }) => rm(root, { recursive: true, force: true })),
  );
  const file = path.join(root, 'nested', 'credential.json');
  const crypto = {
    encryptString: (value) => Buffer.from(`encrypted:${value}`),
    decryptString: (value) => {
      const text = value.toString();
      if (!text.startsWith('encrypted:')) throw new Error('private decrypt failure');
      return text.slice('encrypted:'.length);
    },
  };
  return { root, file, crypto, credentials: new SpeechCredentials(file, crypto) };
}

test('credentials distinguish absent from unreadable and save encrypted owner-only content', async (t) => {
  const { file, credentials } = await fixture(t);
  await mkdir(path.dirname(file), { recursive: true });
  assert.deepEqual(await credentials.status(), { configured: false, unreadable: false });
  assert.equal(await credentials.load(), null);
  await credentials.save('AIza-very-secret-value');
  assert.deepEqual(await credentials.status(), { configured: true, unreadable: false });
  assert.equal(await credentials.load(), 'AIza-very-secret-value');
  const persisted = await readFile(file, 'utf8');
  assert.ok(!persisted.includes('AIza-very-secret-value'));
  assert.equal((await stat(file)).mode & 0o777, 0o600);
});

test('credentials replace atomically, restore after reopen, and remove idempotently', async (t) => {
  const { file, crypto, credentials } = await fixture(t);
  await credentials.save('AIza-original-secret');
  await credentials.save('AIza-replacement-secret');
  assert.equal(await new SpeechCredentials(file, crypto).load(), 'AIza-replacement-secret');
  await credentials.remove();
  await credentials.remove();
  assert.deepEqual(await credentials.status(), { configured: false, unreadable: false });
});

test('authorization keys retain their period when encrypted and restored', async (t) => {
  const { file, crypto, credentials } = await fixture(t);
  const key = 'AQ.SyntheticCredential_0123456789';
  await credentials.save(key);
  assert.deepEqual(await credentials.status(), { configured: true, unreadable: false });
  assert.equal(await new SpeechCredentials(file, crypto).load(), key);
  assert.ok(!(await readFile(file, 'utf8')).includes(key));
});

test('invalid key text never replaces saved credentials or leaks in errors', async (t) => {
  const { file, credentials } = await fixture(t);
  await credentials.save('AQ.SyntheticExistingCredential_0123456789');
  const before = await readFile(file, 'utf8');
  for (const key of [
    'AQ.masked***value',
    'AQ.html&#x52;escaped',
    'AQ.embedded\nnewline',
    'x'.repeat(513),
  ]) {
    await assert.rejects(credentials.save(key), (error) => {
      assert.equal(error.message, 'Gemini API key is invalid.');
      return true;
    });
    assert.equal(await readFile(file, 'utf8'), before);
  }
});

test('failed encryption preserves the prior credential file', async (t) => {
  const { file, crypto, credentials } = await fixture(t);
  await credentials.save('AIza-preserve-this-secret');
  const before = await readFile(file, 'utf8');
  const failing = new SpeechCredentials(file, {
    ...crypto,
    encryptString() {
      throw new Error('sensitive crypto detail');
    },
  });
  await assert.rejects(failing.save('AIza-another-secret'), /Could not encrypt/);
  assert.equal(await readFile(file, 'utf8'), before);
});

test('failed filesystem replacement leaves old credentials and no temp debris', async (t) => {
  const { file, root, crypto, credentials } = await fixture(t);
  await credentials.save('AIza-preserve-this-secret');
  const before = await readFile(file, 'utf8');
  const blocked = new SpeechCredentials(path.join(file, 'not-a-file'), crypto);
  await assert.rejects(blocked.save('AIza-next-secret'), /Could not save/);
  assert.equal(await readFile(file, 'utf8'), before);
  assert.deepEqual(await readdir(path.dirname(file)), ['credential.json']);
  assert.ok(root);
});

test('corrupt or undecryptable credential stays configured and reports unreadable without leaking errors', async (t) => {
  const { file, credentials } = await fixture(t);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(
    file,
    JSON.stringify({ version: 1, encrypted: Buffer.from('wrong').toString('base64') }),
    { mode: 0o600 },
  );
  assert.deepEqual(await credentials.status(), { configured: true, unreadable: true });
  await assert.rejects(credentials.load(), (error) => !error.message.includes('private'));
});
