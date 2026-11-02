# Bounded Gemini rate-limit retries and ordered narration prefetch

## Context and decisions

The user authorized committing the existing Gemini fixes before adding automatic HTTP 429 recovery and eager synthesis of later narration paragraphs. Committed the prior AQ key, safe HTTP diagnostics, and pending Test voice button changes as `3574dc5` (`Fix Gemini key support, speech diagnostics, and test button pending state`). The new enhancements remain uncommitted; nothing was pushed.

Previously the adapter did not retry 429 responses, and the renderer synthesized each chunk only after previous playback ended. Google’s current API error reference distinguishes temporary `rate_limit_exceeded` / `too_many_requests` from daily `quota_exceeded`: https://ai.google.dev/gemini-api/docs/api-errors . We retry only explicit temporary 429 responses; uncertain network errors, timeouts, other HTTP failures, and uploads remain single-attempt.

## Implemented changes

- `src/desktop/gemini-speech.ts`: up to four generation retries, cancellable exponential backoff with jitter (5, 10, 20, 40 seconds plus jitter absent provider hints), respecting the larger of Retry-After (seconds or HTTP date) and Google RetryInfo. TTS has a three-minute total budget and retains the two-minute per-attempt bound; transcription retains its two-minute overall budget. Server delays exceeding remaining budget stop instead of retrying prematurely. Known daily-quota codes/details stop immediately. Exhaustion and daily quota have safe explanatory messages. Provider bodies, text, recordings, and keys are never included in retry diagnostics.
- `desktop/main.mts`: logs only model, retry number, and delay for temporary 429 recovery. Diagnostic failures cannot break speech.
- `desktop/narration.ts`: prepares one future chunk/request while current audio plays, including the next already-queued message. Synthesis stays sequential; playback stays ordered. A delayed retry blocks later chunks from overtaking it. Future failures are captured immediately and surfaced in playback order, avoiding unhandled promise rejection. Cancellation, mute, skip, replay, voice change, recording, campaign changes, and playback failures discard stale future work. Cancel operations remain serialized. Prefetch is bounded to one chunk to limit memory and unused paid synthesis.
- `docs/desktop.md` and `docs/architecture.md`: document overlap, tier-independent behavior, retry bounds, cancellation, and possible usage charges for prefetched audio discarded by the user.

## Verification actually run

- `npm run typecheck`: passed.
- `TMPDIR=/private/tmp node --test test/gemini-speech.test.mjs test/narration.test.mjs`: 44 passed. Includes hint precedence/date parsing, oversized hints, exponential fallback, retry cap, cancellation during wait, daily quota identifiers, safe diagnostics, transcription retry cleanup, no upload retry, ordered prefetch, delayed future results, cancellation variants, and playback failure.
- `TMPDIR=/private/tmp npm test -- --test-concurrency=4`: 253 passed, no failures.
- Desktop UI suite (`node --test` over the seven files listed by `test:desktop`, with `TMPDIR=/private/tmp`): 7 passed, including main/local-player speech isolation and credential restoration.
- Changed-file Prettier check and `git diff --check`: passed.
- `TMPDIR=/private/tmp npm run desktop:dist`: passed. Refreshed unsigned macOS arm64 app, DMG, and ZIP in ignored `release/`.
- `TMPDIR=/private/tmp npm run desktop:smoke -- --launch`: passed; packaged UI rendered and bundled worker answered IPC.
- Separate read-only reviews found no blocking narration or retry issues.

An early reviewer full-suite run without the canonical temporary path hit the existing `/tmp` symlink restriction in an artwork test. Early retry test fixtures also needed injected no-op delays after adding real backoff. Those runs are superseded by the final successful focused and full runs above. No existing journal daemon was stopped or reconfigured; journal integration and LAN suites were not rerun for this speech-only change.

## Limitations and next steps

The running development app writes to its terminal, not a persisted speech log. The terminal is not attached to this chat and computer-use access to Terminal was denied, so the reported latest-run 429 log could not be inspected. Behavior was verified with controlled API responses; no live Google requests or real credentials were used during this enhancement.

A message arriving only after the current playback has started will be picked up at the next queue iteration; prefetch considers chunks and messages already known when playback starts. Unrecognized daily-limit descriptions may receive bounded retries before stopping. Discarded prefetched generation may still count toward usage. Restart the development app or install the refreshed release to exercise the changes; observe safe retry messages in the development launch terminal. Commit the new changes only on further user authorization.