# Gemini speech replaces Phonon with secure desktop credentials and dictation

## Context and decisions

Implemented the approved Gemini speech migration. Speech is optional and independent of the CLI-managed DM provider. The app remains usable through text without a key. Direct Gemini requests are limited to speech, with narration resolved from exact public campaign message references by DesktopHost. No campaign records or real credentials were used in verification. This entry supersedes the incomplete verification status in the earlier packaging milestone.

## Completed changes

- Added `src/desktop/gemini-speech.ts`, `speech-credentials.ts`, and `speech-service.ts`: Gemini Flash TTS (`gemini-3.8-flash-tts`), verbatim recorded transcription (`gemini-3.5-transcribe`), bounded responses, deadlines, cancellation, sanitized service errors, upload processing polling and file cleanup. Billed generation is not automatically retried.
- Credentials use asynchronous Electron safeStorage in main, an atomic owner-only encrypted file in the shared application settings profile, and no plaintext fallback. Failed decryptions preserve the file. Renderer settings expose only status; keys are not restored into inputs or passed to workers/DM CLIs.
- Repurposed settings with AI Studio instructions, billing/data disclosure, save/replace/remove, explicit voice test, autoplay choice, and 30 prebuilt voices defaulting to Kore. Existing mute/autoplay preferences survive migration; new installations default autoplay off.
- Preserved narration ordering/replay/mute/skip and historical/setup exclusions. Recording suspends narration. New `desktop/dictation.ts` provides bounded in-memory WebM recording and editable transcript append, stale-context rejection, cancellation and prompt microphone release.
- Added a minimal `desktop/player-preload.cts` bridge for host-created player windows on the active loopback server only. Remote LAN browsers remain text-only. Main-frame/origin checks and audio-only permissions deny untrusted frames, cameras and unrelated permissions.
- Removed Phonon installers, Python/runtime scripts, license UI/contracts and packaged assets. Existing user caches are untouched. Added packaged macOS microphone usage text; updated architecture, desktop documentation and project instructions.
- Added regression tests for credentials, API errors/cancellation/cleanup, lifecycle races, dictation and desktop boundaries. Fixed an existing hotseat test teardown race by closing its host before removing the fixture workspace.

## Verification actually run

- `npm run typecheck`: passed.
- `TMPDIR=/private/tmp npm test -- --test-concurrency=4`: 229/229 passed.
- `TMPDIR=/private/tmp npm run test:desktop`: 7/7 passed.
- `TMPDIR=/private/tmp DM_CHROME='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' npm run test:lan`: 1/1 passed.
- `TMPDIR=/private/tmp npm run test:journal`: 1/1 passed using isolated temporary workspaces; the user's shared journal daemon was not stopped or reconfigured.
- Packaging regression tests: passed (also included in the unit suite).
- `TMPDIR=/private/tmp npm run desktop:dist`: passed, producing the unsigned macOS arm64 DMG, ZIP and app in `release/`.
- `TMPDIR=/private/tmp npm run desktop:smoke -- --launch`: passed with the actual packaged UI/worker and no Phonon resources or saved credentials in the bundle.
- Packaged `test/speech-main-ui.mjs`: passed with real macOS safeStorage and synthetic credentials, including microphone/camera and local player boundary checks.
- Additional isolated cross-build launch check: saved a synthetic key through the development renderer, closed development Electron, launched the packaged app with the same temporary profile, verified configured/available status, and removed the credential. Passed using real macOS safeStorage; made no Gemini request.
- `git diff --check`: passed. Changed-file formatting checks passed. Repository-wide `npm run format:check` still reports 30 pre-existing unrelated files, largely historical journal entries and `test/gameplay.test.mjs`; these were left untouched.

Earlier verification attempts exposed the macOS `/tmp` symlink mismatch, an existing hotseat teardown race, and a transient process-death timing assertion under concurrent load. The final complete suite passed with canonical temporary paths and bounded concurrency after the teardown fix. LAN testing required the installed macOS Chrome path instead of the Linux default.

## Limitations and next steps

No real Gemini key was supplied, so live model availability, billing/quota and actual narration/transcription quality remain unverified. Enter a key through Speech settings and run a short synthetic voice/dictation smoke test. Unsigned macOS builds can request OS Keychain authorization. If an upload succeeds remotely but its file-ID response is lost or malformed, cleanup cannot identify that unknown remote file; known uploaded file IDs are cleaned up on completion, failure and cancellation.

Release artifacts: `release/Dungeon Master-0.6.0-arm64.dmg`, `release/Dungeon Master-0.6.0-arm64.zip`, and `release/mac-arm64/Dungeon Master.app`. No commit or push was performed.
