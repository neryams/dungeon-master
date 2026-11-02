# Accept Gemini authorization keys across speech save restore and requests

## Context and diagnosis

The user reported that a newly generated Google AI Studio key was rejected locally with `Enter a valid Gemini API key`. No real key was obtained or used. The existing duplicated token validation allowed letters, digits, underscores and hyphens but rejected periods, including the `AQ.` authorization-key prefix. The request never reached Google. Google's current documentation confirms that AI Studio creates authorization keys by default: https://ai.google.dev/gemini-api/docs/api-key . Google's developer forum also confirms the AQ key transition: https://discuss.ai.google.dev/t/api-key-errors-with-keys-starting-with-aq/170436 .

## Completed changes and rationale

- Added one shared `SpeechApiKey` schema in `src/desktop/contracts.ts`, accepting periods while retaining length bounds and rejecting whitespace/control characters, HTML escape sequences and masked placeholders. The desktop boundary trims surrounding whitespace; authenticity remains Google's responsibility.
- Reused the schema in credential save/decryption (`src/desktop/speech-credentials.ts`) and both synthesis/transcription request validation (`src/desktop/gemini-speech.ts`). This prevents disagreement between saving, restoration and service use.
- Aligned the password input's maximum length with the existing 512-character backend limit.
- Added synthetic AQ-format regression coverage for IPC normalization, encrypted save/reopen, failed input preserving existing credentials, and unchanged `x-goog-api-key` transmission. Updated the actual Electron secure-storage test to use an entirely synthetic AQ-format token.
- Rebuilt unsigned macOS release artifacts. They include this fix and the previously committed speech-notation filter (`14cc594`). No changes were made to real application profiles or credentials.

## Verification actually run

- `npm run typecheck`: passed.
- `TMPDIR=/private/tmp npm test -- --test-concurrency=4`: 233/233 passed. The initial run caught an additional stale validator inside GeminiSpeech; that validator now uses the shared schema, and the full rerun passed.
- `TMPDIR=/private/tmp node --test test/speech-main-ui.mjs`: 1/1 passed in development Electron, with isolated profile and synthetic token.
- `TMPDIR=/private/tmp npm run desktop:dist`: passed.
- `TMPDIR=/private/tmp npm run desktop:smoke -- --launch`: passed.
- Packaged `test/speech-main-ui.mjs` using `DM_TEST_DESKTOP_EXECUTABLE` pointing to `release/mac-arm64/Dungeon Master.app/Contents/MacOS/Dungeon Master`: 1/1 passed.
- Changed files formatted with Prettier; `git diff --check` passed before journal creation.

## Limitations and next steps

No live Google request was made. Restart `npm run desktop`, or replace the installed app using the rebuilt `release/Dungeon Master-0.6.0-arm64.dmg`, then paste the raw key using AI Studio's copy button and explicitly choose Test voice. Literal HTML entities or masking characters must not be pasted as part of a key; surrounding whitespace is trimmed. The fix is uncommitted, and nothing was pushed. Journal integration code was not changed and its runtime was not disturbed.
