import test from 'node:test';
import assert from 'node:assert/strict';
import { speechEligibleRevisions, speechParts } from '../dist/desktop/speech-text.js';

function event(sequence, { review, table } = {}) {
  return {
    schemaVersion: 1,
    id: `event-${sequence}`,
    sequence,
    operationId: `operation-${sequence}`,
    requestHash: 'hash',
    timestamp: '2026-10-22T12:00:00.000Z',
    actor: 'DM',
    reason: '',
    payload: {
      changes: [],
      ...(review ? { review } : {}),
      ...(table ? { table } : {}),
    },
  };
}

test('speech eligibility follows the review policy at each publication revision', () => {
  const events = [
    event(1, { table: { type: 'publish', requestId: 'one', text: 'Legacy opening' } }),
    event(2, { review: { type: 'configure', mode: 'setup', reason: 'Prepare campaign' } }),
    event(3, { table: { type: 'publish', requestId: 'two', text: 'Setup question' } }),
    event(4, { review: { type: 'configure', mode: 'reviewed', reason: 'Opening is ready' } }),
    event(5, { table: { type: 'publish', requestId: 'three', text: 'First scene' } }),
    event(6, { review: { type: 'configure', mode: 'setup', reason: 'Reopen setup' } }),
    event(7, { table: { type: 'publish', requestId: 'four', text: 'Setup resumed' } }),
    event(8, { review: { type: 'configure', mode: 'legacy', reason: 'Use legacy mode' } }),
    event(9, { table: { type: 'publish', requestId: 'five', text: 'Legacy again' } }),
  ];
  const original = structuredClone(events);

  assert.deepEqual(speechEligibleRevisions(events), [1, 5, 9]);
  assert.deepEqual(events, original, 'eligibility derivation does not mutate saved events');
});

test('speech text reads Markdown prose and entities while omitting code and destinations', () => {
  const parts = speechParts(
    [
      '# **The Gate &amp; Road**',
      '',
      'A [weathered sign](https://example.test/path) points *east*. `Say hello.`',
      '',
      '- First path',
      '- Second path with ![a silver moon](moon.png)',
      '',
      '```js',
      'console.log("secret code");',
      '```',
      '',
      '    indented secret code',
      '',
      'The <strong>door</strong> opens.',
    ].join('\n'),
  );

  assert.deepEqual(parts, [
    'The Gate & Road',
    'A weathered sign points east. Say hello.',
    'First path',
    'Second path with a silver moon',
    'The door opens.',
  ]);
  assert.doesNotMatch(parts.join(' '), /https|moon\.png|secret code|console\.log|strong/);
});

test('speech text splits at sentence boundaries and bounds long unbroken text', () => {
  const sentences = `${'First sentence. '.repeat(50)}${'Second sentence! '.repeat(50)}`;
  const sentenceParts = speechParts(sentences);
  assert.ok(sentenceParts.length > 1);
  assert.ok(sentenceParts.every((part) => part.length <= 500));
  assert.ok(sentenceParts.slice(0, -1).every((part) => /[.!?]["'”’)]*$/.test(part)));

  const unbroken = speechParts('x'.repeat(1201));
  assert.deepEqual(
    unbroken.map((part) => part.length),
    [500, 500, 201],
  );
  assert.equal(unbroken.join(''), 'x'.repeat(1201));
  assert.deepEqual(speechParts('  \n ```\nignored\n```  '), []);
});
