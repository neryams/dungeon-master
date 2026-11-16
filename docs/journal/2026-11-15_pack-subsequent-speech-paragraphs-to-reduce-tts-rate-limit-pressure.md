# Pack Subsequent Speech Paragraphs to Reduce TTS Rate-Limit Pressure

## Context

Users on Google AI Studio Paid Tier 1 (`Paid 1`) experienced HTTP 429 rate limiting during desktop text-to-speech playback on `gemini-3.8-flash-tts`, even with ~\$100 in eligible GCP credits + prepay balance. Two factors combined:

1. **Billing Tier Criteria**: Tier 2 requires \$100+ USD already _spent_ on the Gemini API since account creation rather than merely holding \$100 of available credits/balance, leaving the project on Paid Tier 1 with tighter RPM/RPD caps on `gemini-3.8-flash-tts`.
2. **Legacy Per-Line Chunking (`src/desktop/speech-text.ts`)**: `speechParts()` was originally tuned for a local sidecar and split every newline (each paragraph, heading, and bullet item) and every 500 characters into a separate chunk. A typical 1,300–1,700 character DM message turned into 8–9 separate Gemini API calls fired rapidly as short bullet chunks finished playing and `NarrationController` prefetched the next part.

Note: `project_journal` MCP tools were not loaded in this session, so this entry was written directly to `docs/journal/` per the fallback documented in `AGENTS.md`.

## Decisions and Rationale

- **Fast first chunk + packed remainder (Option B) in `src/desktop/speech-text.ts`**:
  - Kept `FIRST_PART_LENGTH = 500` and flushed at the end of the first paragraph so initial TTS playback still begins quickly.
  - Raised subsequent chunk capacity to `MAX_PART_LENGTH = 2500` and replaced per-line flat-mapping (`normalized.split('\n').flatMap(splitSpeechText)`) with `packSpeechParagraphs()`, which joins packed paragraphs with `\n` and sentences within a paragraph with `' '`, well within `GeminiSpeech`'s `MAX_TEXT = 20_000` character limit and `MAX_AUDIO_BYTES = 10 MiB` WAV limit.
  - This preserves natural paragraph pauses inside `gemini-3.8-flash-tts` while compressing multi-paragraph/bulleted DM replies from ~8–9 API calls down to ~2 calls (chunk 0 for fast start, chunk 1 prefetched during playback), reducing both RPM bursts and daily RPD consumption by roughly 75–80%.

## Completed Changes

- `src/desktop/speech-text.ts`: Replaced `MAX_PART_LENGTH = 500` and `splitSpeechText` / `splitAtLimit` with `FIRST_PART_LENGTH = 500`, `MAX_PART_LENGTH = 2500`, and `packSpeechParagraphs()`.
- `test/speech-text.test.mjs`: Updated Markdown prose, sentence-boundary, unbroken-text (`3201` chars -> `[500, 2500, 201]`), and mechanical-annotation tests to verify first-paragraph flushing and `\n`-joined packing up to 2,500 characters, plus overflow from a `>500`-character opening paragraph.

## Verification

- `npm run typecheck`: passed.
- `TMPDIR=/private/tmp node --test test/speech-text.test.mjs test/speech-host.test.mjs test/gemini-speech.test.mjs test/narration.test.mjs`: 52/52 passed.
- `TMPDIR=/private/tmp npm test -- --test-concurrency=4`: 269/269 passed.
- Prettier check and `git diff --check`: passed.

## Known Limitations and Next Steps

- Very long single-turn narrations exceeding ~3,000 characters still emit additional 2,500-character chunks.
- Paid Tier 1 projects remain subject to Google's project RPM/RPD caps on `gemini-3.8-flash-tts` until Tier 2 spend thresholds are reached.
- Restart the desktop app (`npm run desktop`) so the running worker/build picks up the updated `dist/desktop/speech-text.js`.
