# Diagnose speech HTTP 402 and expose safe Gemini API error details

## Context and diagnosis

After the AQ authorization-key fix, Test voice reported only `Gemini speech request failed`. The adapter collapsed unrecognized HTTP failures into that generic message. One short synthetic live narration request was made from an isolated Electron diagnostic using the existing encrypted credential through asynchronous safeStorage, without returning or printing the key or provider response body. The safe result was HTTP 402, mapped to payment/credits required. No additional live requests were made. The application's existing settings and campaign workspace were not modified by the diagnostic.

## Implemented changes

- `src/desktop/gemini-speech.ts` now retains HTTP status and allowlisted documented API error codes, with specific guidance for billing, malformed parameters, project prerequisites, authentication, permission, quota/rate-limit, timeout, and service failures. Unknown messages/details never cross IPC. Parsing is bounded to 16 KiB; empty, malformed, or oversized error bodies preserve status-based guidance. Cancellation and timeout are rechecked after parsing. No automatic generation retries were added.
- API documentation review confirmed the existing TTS single-speaker array, WAV response format, REST audio extraction and `store:false` are valid. It exposed an independent transcription bug: `transcription_config.mode` must be `{type:'verbatim'}` rather than a string. Corrected and covered by the request test.
- `desktop/dom.ts` strips Electron's remote-method wrapper from displayed Error/GeminiSpeechError messages.
- Added error classification and privacy regression coverage, including numeric legacy Google statuses and unknown upstream codes. Review caught a missing HTTP400/UNAUTHENTICATED mapping; corrected before the final unit run.

## Actual verification

- `npm run typecheck`: passed.
- `TMPDIR=/private/tmp npm test -- --test-concurrency=4`: 236/236 passed on the final run.
- `TMPDIR=/private/tmp npm run test:desktop`: 7/7 passed.
- Direct compiled-renderer errorMessage assertion: billing message retains HTTP402 and strips IPC wrapper; ordinary messages remain intact.
- Changed-file Prettier checks and `git diff --check`: passed.
- `TMPDIR=/private/tmp npm run desktop:dist`: passed.
- `TMPDIR=/private/tmp npm run desktop:smoke -- --launch`: passed.
- Packaged `test/speech-main-ui.mjs` with isolated synthetic credentials: 1/1 passed.
- The unsigned app, DMG and ZIP in `release/` now include the AQ key fix, narration annotation filtering, and these diagnostics/transcription changes.

## Billing research and qualification

The observed HTTP402 is a real payment-path error for that request, but it does not establish that these models have no free tier. Current official pricing lists free input/output for standard `gemini-3.8-flash-tts` and `gemini-3.5-transcribe`, subject to project eligibility and limits. Google AI Ultra/Pro's baseline AI Studio allowances apply to its web interfaces; external API keys use separate project billing. Eligible subscription Cloud credits can cover API usage, but prepaid billing requires a positive paid balance even when promotional credits are available. This qualifies the initial advice to add credits: inspect project tier/eligibility and available subscription Cloud credits first.

Sources checked November 1, 2026:
- https://ai.google.dev/gemini-api/docs/api-errors
- https://ai.google.dev/gemini-api/docs/speech-generation
- https://ai.google.dev/gemini-api/docs/transcribe
- https://ai.google.dev/gemini-api/docs/google-ai-plans
- https://ai.google.dev/gemini-api/docs/pricing
- https://developers.google.com/profile/help/faq

## Limitations and next steps

Successful live synthesis and transcription remain unverified because the one live voice test was rejected with HTTP402. Resolve the selected project's billing/credit state or use an eligible free-tier project, then explicitly test voice in the UI. No billing settings were changed. Source changes remain uncommitted; no push was performed. Journal integration code/runtime was untouched.
