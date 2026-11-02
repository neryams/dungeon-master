import test from 'node:test';
import assert from 'node:assert/strict';
import { GeminiSpeech, GeminiSpeechError } from '../dist/desktop/gemini-speech.js';

function wav() {
  const b = Buffer.alloc(46);
  b.write('RIFF', 0);
  b.writeUInt32LE(38, 4);
  b.write('WAVE', 8);
  b.write('fmt ', 12);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22);
  b.writeUInt32LE(24000, 24);
  b.writeUInt32LE(48000, 28);
  b.writeUInt16LE(2, 32);
  b.writeUInt16LE(16, 34);
  b.write('data', 36);
  b.writeUInt32LE(2, 40);
  b.writeInt16LE(12, 44);
  return b;
}
function response(body, options = {}) {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status: options.status ?? 200,
    headers: options.headers,
  });
}

test('Gemini TTS uses Interactions API and returns only validated WAV', async () => {
  let request;
  const service = new GeminiSpeech({
    fetch: async (url, init) => {
      request = { url, init };
      return response({
        steps: [
          { type: 'model_output', content: [{ type: 'audio', data: wav().toString('base64') }] },
        ],
      });
    },
  });
  const key = 'AQ.SyntheticHeaderKey_0123456789';
  const result = await service.synthesize(key, 'The gate opens.', 'Kore');
  assert.equal(Buffer.from(result, 'base64').toString('ascii', 0, 4), 'RIFF');
  assert.equal(request.url, 'https://generativelanguage.googleapis.com/v1beta/interactions');
  assert.equal(request.init.headers.get('x-goog-api-key'), key);
  const payload = JSON.parse(request.init.body);
  assert.equal(payload.model, 'gemini-3.8-flash-tts');
  assert.equal(payload.store, false);
  assert.equal(payload.generation_config.speech_config[0].voice, 'Kore');
});

test('Gemini STT uploads in memory, transcribes, then deletes the validated file', async () => {
  const calls = [];
  const service = new GeminiSpeech({
    fetch: async (url, init) => {
      calls.push({ url, init });
      if (url === 'https://generativelanguage.googleapis.com/upload/v1beta/files')
        return response(undefined, {
          headers: {
            'x-goog-upload-url':
              'https://generativelanguage.googleapis.com/upload/v1beta/files/session',
          },
        });
      if (url.endsWith('/session'))
        return response({
          file: {
            name: 'files/f_123',
            uri: 'https://generativelanguage.googleapis.com/v1beta/files/f_123',
          },
        });
      if (url.endsWith('/interactions')) return response({ output_text: 'A goblin approaches.' });
      if (init.method === 'DELETE') return response({});
      assert.fail(`Unexpected URL ${url}`);
    },
  });
  const audio = Buffer.from('tiny audio').toString('base64');
  assert.equal(await service.transcribe('abcdefghijk', audio, 'audio/wav'), 'A goblin approaches.');
  assert.equal(calls.length, 4);
  assert.equal(calls[1].init.body.toString(), 'tiny audio');
  assert.equal(JSON.parse(calls[2].init.body).model, 'gemini-3.5-transcribe');
  assert.equal(JSON.parse(calls[2].init.body).store, false);
  assert.deepEqual(JSON.parse(calls[2].init.body).generation_config.transcription_config, {
    mode: { type: 'verbatim' },
  });
  assert.equal(calls[3].url, 'https://generativelanguage.googleapis.com/v1beta/files/f_123');
});

test('STT deletes uploaded resource after interaction failure and after caller cancellation', async () => {
  for (const cancel of [false, true]) {
    const calls = [];
    const controller = new AbortController();
    const service = new GeminiSpeech({
      fetch: async (url, init) => {
        calls.push({ url, init });
        if (url.endsWith('/files'))
          return response(undefined, {
            headers: {
              'x-goog-upload-url':
                'https://generativelanguage.googleapis.com/upload/v1beta/files/session',
            },
          });
        if (url.endsWith('/session'))
          return response({
            file: {
              name: 'files/file_1',
              uri: 'https://generativelanguage.googleapis.com/v1beta/files/file_1',
            },
          });
        if (url.endsWith('/interactions')) {
          if (cancel) controller.abort();
          throw new Error('private upstream details');
        }
        if (init.method === 'DELETE') return response({});
        assert.fail(`Unexpected URL ${url}`);
      },
    });
    await assert.rejects(
      service.transcribe(
        'abcdefghijk',
        Buffer.from('audio').toString('base64'),
        'audio/wav',
        controller.signal,
      ),
      (error) =>
        error instanceof GeminiSpeechError &&
        ['network', 'cancelled'].includes(error.code) &&
        !error.message.includes('private'),
    );
    assert.equal(calls.at(-1).init.method, 'DELETE');
  }
});

test('Gemini speech rejects malformed WAV, oversized or invalid input, and untrusted upload URLs', async () => {
  const malformed = new GeminiSpeech({
    fetch: async () =>
      response({
        steps: [{ content: [{ type: 'audio', data: Buffer.from('not wav').toString('base64') }] }],
      }),
  });
  await assert.rejects(
    malformed.synthesize('abcdefghijk', 'words', 'Kore'),
    (e) => e.code === 'invalid_response',
  );
  const unused = new GeminiSpeech({
    fetch: async () => {
      assert.fail('must reject before network');
    },
  });
  await assert.rejects(
    unused.transcribe(
      'abcdefghijk',
      Buffer.alloc(10 * 1024 * 1024 + 1).toString('base64'),
      'audio/wav',
    ),
    (e) => e.code === 'invalid_input',
  );
  const hostile = new GeminiSpeech({
    fetch: async (url) =>
      url.endsWith('/files')
        ? response(undefined, { headers: { 'x-goog-upload-url': 'https://evil.example/session' } })
        : assert.fail('untrusted upload URL must not be used'),
  });
  await assert.rejects(
    hostile.transcribe('abcdefghijk', Buffer.from('audio').toString('base64'), 'audio/wav'),
    (e) => e.code === 'invalid_response',
  );
});

test('requests time out without exposing upstream response content', async () => {
  const service = new GeminiSpeech({
    timeoutMs: 10,
    fetch: (_url, init) =>
      new Promise((_resolve, reject) => {
        init.signal.addEventListener('abort', () => reject(new Error('secret key upstream')));
      }),
  });
  await assert.rejects(
    service.synthesize('abcdefghijk', 'text', 'Kore'),
    (error) =>
      error instanceof GeminiSpeechError &&
      error.code === 'timeout' &&
      !error.message.includes('secret'),
  );
});

test('TTS accepts a valid WAV response above the transcription JSON bound', async () => {
  const audio = Buffer.alloc(2 * 1024 * 1024);
  audio.write('RIFF', 0);
  audio.writeUInt32LE(audio.length - 8, 4);
  audio.write('WAVE', 8);
  audio.write('fmt ', 12);
  audio.writeUInt32LE(16, 16);
  audio.writeUInt16LE(1, 20);
  audio.writeUInt16LE(1, 22);
  audio.writeUInt32LE(24000, 24);
  audio.writeUInt32LE(48000, 28);
  audio.writeUInt16LE(2, 32);
  audio.writeUInt16LE(16, 34);
  audio.write('data', 36);
  audio.writeUInt32LE(audio.length - 44, 40);
  const service = new GeminiSpeech({
    fetch: async () =>
      response({
        steps: [
          { type: 'model_output', content: [{ type: 'audio', data: audio.toString('base64') }] },
        ],
      }),
  });
  assert.equal(
    Buffer.from(await service.synthesize('abcdefghijk', 'longer narration', 'Kore'), 'base64')
      .length,
    audio.length,
  );
});

test('HTTP categories are sanitized and every key-bearing request rejects redirects', async () => {
  for (const [status, code] of [
    [400, 'invalid_key'],
    [403, 'access_denied'],
    [404, 'model_unavailable'],
    [429, 'quota'],
  ]) {
    const service = new GeminiSpeech({
      fetch: async (_url, init) => {
        assert.equal(init.redirect, 'error');
        return new Response(
          JSON.stringify({
            error: { status: 'API_KEY_INVALID', message: 'private credential detail' },
          }),
          { status },
        );
      },
    });
    await assert.rejects(
      service.synthesize('abcdefghijk', 'words', 'Kore'),
      (e) => e.code === code && !e.message.includes('private'),
    );
  }
});

test('speech reports HTTP status and documented API codes with actionable safe messages', async () => {
  for (const [status, apiCode, category, guidance] of [
    [400, 'invalid_request', 'invalid_request', /request parameters/],
    [400, 'parameter_unknown', 'invalid_request', /compatibility update/],
    [400, 'failed_precondition', 'precondition', /prerequisite/],
    [400, 'UNAUTHENTICATED', 'invalid_key', /key was rejected/],
    [402, 'payment_required', 'billing', /payment or additional credits/],
    [403, 'permission_denied', 'access_denied', /permissions/],
    [429, 'rate_limit_exceeded', 'quota', /rate limit/],
    [503, 'service_unavailable', 'service_unavailable', /Try again later/],
    [504, 'deadline_exceeded', 'timeout', /timed out/],
  ]) {
    let requests = 0;
    const service = new GeminiSpeech({
      fetch: async () => {
        requests++;
        return response(
          {
            error: {
              code: apiCode,
              message: 'PRIVATE prompt and key AQ.SyntheticSecret_0123456789',
              details: [{ project: 'PRIVATE-project' }],
            },
          },
          { status },
        );
      },
    });
    await assert.rejects(
      service.synthesize('AQ.SyntheticSecret_0123456789', 'words', 'Kore'),
      (error) => {
        assert.equal(error.code, category);
        assert.equal(error.httpStatus, status);
        assert.equal(error.apiCode, apiCode);
        assert.match(error.message, guidance);
        assert.ok(error.message.includes(`HTTP ${status}; ${apiCode}`));
        assert.doesNotMatch(JSON.stringify(error) + error.message, /PRIVATE|SyntheticSecret/);
        return true;
      },
    );
    assert.equal(requests, 1, 'Failures do not automatically retry billed requests');
  }
});

test('HTTP diagnostics retain status without exposing unknown or malformed upstream data', async () => {
  for (const body of [
    JSON.stringify({
      error: { code: 'PRIVATE-secret', status: 'PRIVATE-secret', message: 'PRIVATE-secret' },
    }),
    '<html>PRIVATE-secret</html>',
    'PRIVATE-secret'.repeat(2000),
    '',
  ]) {
    const service = new GeminiSpeech({ fetch: async () => new Response(body, { status: 402 }) });
    await assert.rejects(service.synthesize('abcdefghijk', 'words', 'Kore'), (error) => {
      assert.equal(error.code, 'billing');
      assert.equal(error.httpStatus, 402);
      assert.equal(error.apiCode, undefined);
      assert.match(error.message, /HTTP 402/);
      assert.doesNotMatch(error.message, /PRIVATE/);
      return true;
    });
  }
});

test('legacy failed precondition is reported without revealing the provider message', async () => {
  const service = new GeminiSpeech({
    fetch: async () =>
      response(
        {
          error: {
            code: 400,
            status: 'FAILED_PRECONDITION',
            message: 'PRIVATE project billing details',
          },
        },
        { status: 400 },
      ),
  });
  await assert.rejects(service.synthesize('abcdefghijk', 'words', 'Kore'), (error) => {
    assert.equal(error.code, 'precondition');
    assert.equal(error.apiCode, 'FAILED_PRECONDITION');
    assert.doesNotMatch(error.message, /PRIVATE/);
    return true;
  });
});

test('malformed uploaded URI still triggers deletion and only model output text is returned', async () => {
  const calls = [];
  const malformed = new GeminiSpeech({
    fetch: async (url, init) => {
      calls.push({ url, init });
      if (url.endsWith('/files'))
        return response(undefined, {
          headers: { 'x-goog-upload-url': 'https://generativelanguage.googleapis.com/session' },
        });
      if (url.endsWith('/session'))
        return response({ file: { name: 'files/file_2', uri: 'https://evil.example/file' } });
      if (init.method === 'DELETE') return response({});
      assert.fail(`Unexpected request to ${url}`);
    },
  });
  await assert.rejects(
    malformed.transcribe('abcdefghijk', Buffer.from('audio').toString('base64'), 'audio/wav'),
    (e) => e.code === 'invalid_response',
  );
  assert.equal(calls.at(-1).init.method, 'DELETE');

  const output = new GeminiSpeech({
    fetch: async (url) => {
      if (url.endsWith('/files'))
        return response(undefined, {
          headers: { 'x-goog-upload-url': 'https://generativelanguage.googleapis.com/session' },
        });
      if (url.endsWith('/session'))
        return response({
          file: { name: 'files/file_3', uri: 'https://generativelanguage.googleapis.com/file' },
        });
      if (url.endsWith('/interactions'))
        return response({
          steps: [
            { type: 'thought', content: [{ type: 'text', text: 'not output' }] },
            {
              type: 'model_output',
              content: [
                { type: 'text', text: 'A ' },
                { type: 'text', text: 'dragon.' },
              ],
            },
          ],
        });
      return response({});
    },
  });
  assert.equal(
    await output.transcribe('abcdefghijk', Buffer.from('audio').toString('base64'), 'audio/wav'),
    'A dragon.',
  );
});

test('actual malformed RIFF response is rejected', async () => {
  const invalid = wav();
  invalid.write('NOPE', 0);
  const service = new GeminiSpeech({
    fetch: async () =>
      response({
        steps: [
          { type: 'model_output', content: [{ type: 'audio', data: invalid.toString('base64') }] },
        ],
      }),
  });
  await assert.rejects(
    service.synthesize('abcdefghijk', 'words', 'Kore'),
    (e) => e.code === 'invalid_response',
  );
});

test('oversized STT interaction response and caller cancellation both clean uploaded resources', async () => {
  let deletions = 0;
  const oversized = new GeminiSpeech({
    fetch: async (url, init) => {
      if (url.endsWith('/files'))
        return response(undefined, {
          headers: { 'x-goog-upload-url': 'https://generativelanguage.googleapis.com/session' },
        });
      if (url.endsWith('/session'))
        return response({
          file: { name: 'files/large_1', uri: 'https://generativelanguage.googleapis.com/file' },
        });
      if (url.endsWith('/interactions'))
        return new Response(JSON.stringify({ data: 'x'.repeat(2 * 1024 * 1024) }));
      if (init.method === 'DELETE') {
        deletions++;
        return response({});
      }
      assert.fail(`Unexpected request to ${url}`);
    },
  });
  await assert.rejects(
    oversized.transcribe('abcdefghijk', Buffer.from('audio').toString('base64'), 'audio/wav'),
    (e) => e.code === 'invalid_response',
  );
  assert.equal(deletions, 1);

  const abort = new AbortController();
  const cancelled = new GeminiSpeech({
    fetch: async (url, init) => {
      if (url.endsWith('/files'))
        return response(undefined, {
          headers: { 'x-goog-upload-url': 'https://generativelanguage.googleapis.com/session' },
        });
      if (url.endsWith('/session'))
        return response({
          file: { name: 'files/cancel_1', uri: 'https://generativelanguage.googleapis.com/file' },
        });
      if (url.endsWith('/interactions')) {
        abort.abort();
        return response({ output_text: 'too late' });
      }
      if (init.method === 'DELETE') {
        deletions++;
        return response({});
      }
      assert.fail(`Unexpected request to ${url}`);
    },
  });
  await assert.rejects(
    cancelled.transcribe(
      'abcdefghijk',
      Buffer.from('audio').toString('base64'),
      'audio/wav',
      abort.signal,
    ),
    (e) => e.code === 'cancelled',
  );
  assert.equal(deletions, 2);
});

test('cleanup failures surface a safe error after a file resource is known', async () => {
  const service = new GeminiSpeech({
    fetch: async (url, init) => {
      if (url.endsWith('/files'))
        return response(undefined, {
          headers: { 'x-goog-upload-url': 'https://generativelanguage.googleapis.com/session' },
        });
      if (url.endsWith('/session'))
        return response({
          file: { name: 'files/cleanup_1', uri: 'https://generativelanguage.googleapis.com/file' },
        });
      if (url.endsWith('/interactions')) return response({ output_text: 'done' });
      if (init.method === 'DELETE') return new Response(null, { status: 500 });
      assert.fail(`Unexpected request to ${url}`);
    },
  });
  await assert.rejects(
    service.transcribe('abcdefghijk', Buffer.from('audio').toString('base64'), 'audio/wav'),
    (e) => e.code === 'cleanup_failed' && !e.message.includes('credential'),
  );
});

test('STT polls processing files until ACTIVE and aborts the poll while deleting the file', async () => {
  const calls = [];
  let metadataPolls = 0;
  const ready = new GeminiSpeech({
    fetch: async (url, init) => {
      calls.push({ url, init });
      if (init.method === 'DELETE') return response({});
      if (url.endsWith('/files'))
        return response(undefined, {
          headers: { 'x-goog-upload-url': 'https://generativelanguage.googleapis.com/session' },
        });
      if (url.endsWith('/session'))
        return response({
          file: {
            name: 'files/poll_1',
            uri: 'https://generativelanguage.googleapis.com/file',
            state: 'PROCESSING',
          },
        });
      if (url.endsWith('/files/poll_1')) {
        metadataPolls++;
        return response({
          name: 'files/poll_1',
          uri: 'https://generativelanguage.googleapis.com/file',
          state: metadataPolls === 1 ? 'PROCESSING' : 'ACTIVE',
        });
      }
      if (url.endsWith('/interactions')) return response({ output_text: 'ready' });
      assert.fail(`Unexpected request to ${url}`);
    },
  });
  assert.equal(
    await ready.transcribe('abcdefghijk', Buffer.from('audio').toString('base64'), 'audio/wav'),
    'ready',
  );
  assert.equal(metadataPolls, 2);
  const interactionIndex = calls.findIndex((call) => call.url.endsWith('/interactions'));
  assert.ok(
    interactionIndex >
      calls.findLastIndex(
        (call) => call.init.method === 'GET' && call.url.endsWith('/files/poll_1'),
      ),
  );

  const controller = new AbortController();
  let deleted = false;
  const cancelled = new GeminiSpeech({
    fetch: async (url, init) => {
      if (url.endsWith('/files'))
        return response(undefined, {
          headers: { 'x-goog-upload-url': 'https://generativelanguage.googleapis.com/session' },
        });
      if (url.endsWith('/session'))
        return response({
          file: {
            name: 'files/poll_cancel',
            uri: 'https://generativelanguage.googleapis.com/file',
            state: 'PROCESSING',
          },
        });
      if (url.endsWith('/interactions')) assert.fail('must not start inference while processing');
      if (init.method === 'DELETE') {
        deleted = true;
        return response({});
      }
      assert.fail(`Unexpected request to ${url}`);
    },
  });
  const pending = cancelled.transcribe(
    'abcdefghijk',
    Buffer.from('audio').toString('base64'),
    'audio/wav',
    controller.signal,
  );
  setTimeout(() => controller.abort(), 20);
  await assert.rejects(pending, (e) => e.code === 'cancelled');
  assert.equal(deleted, true);
});
