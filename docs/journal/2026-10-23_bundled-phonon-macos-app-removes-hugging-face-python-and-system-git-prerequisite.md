# Bundled Phonon macOS app removes Hugging Face Python and system Git prerequisites

## Context and decision
The user explicitly requested committing the existing narration/installer work, then bundling Phonon so the DM provider is the only external runtime dependency. Created checkpoint commit `e7f17b1` (`Add local Phonon narration and macOS preview installer`) on `codex/desktop-text-to-speech`. The implementation below remains uncommitted; nothing was pushed or published.

Keep the source application MIT and ship Phonon 40M separately under CC BY-NC 4.0 with full attribution/notices. The user authorized the noncommercial bundle. This supersedes the earlier per-user gated-download requirement for packaged builds. Source developers retain the explicit downloader fallback.

## Implemented changes
- `scripts/package-speech.mjs` stages the native macOS arm64 ptts v0.4.0 CLI, verifies its official archive SHA-256, and includes explicit pinned model/voice files, original voice catalogs, model card, provenance and licenses. It fails on incomplete prepared assets. Maintainers obtain assets with authorized HF access; user tokens, Hub caches and consent receipts never enter the package.
- `electron-builder.config.cjs` places this bundle in `Resources/speech`; `desktop/main.mts` selects it authoritatively for packaged workers and opens the included license text offline. No Python/uv/model download is required for packaged narration.
- `src/desktop/speech-runtime.ts` uses the native local CLI with explicit model/voice paths, argument separation, credential-filtered offline environment, bounded temporary WAV output and cleanup, cancellation generations, deadlines and process termination escalation. Native runtime links only to Apple system libraries/frameworks. Source Python inference remains available outside packaged mode.
- `src/desktop/speech-install.ts`, contracts and desktop UI support immediate bundled activation after acknowledgement and durable skip. The token/access/download controls are hidden for bundled mode. Manifest and required resource/license checks prevent enabling an incomplete bundle. Consent remains per user; campaign events are unchanged.
- `src/cli.ts` uses pinned MIT `isomorphic-git@1.44.3` to initialize valid campaign repositories instead of invoking system Git. Init/import tests run with PATH empty; a local Git check recognized an unborn main branch. The library and its license are included in production dependencies.
- Updated README, architecture/desktop docs and third-party notices to explain the bundled mode, native engine, noncommercial model boundary and source-only fallback.

## Verification actually run
- `TMPDIR=/private/tmp npm test`: 162/162 passed. Canonical temp paths avoid preexisting macOS symlink fixture mismatches.
- `TMPDIR=/private/tmp npm run test:desktop`: 4/4 passed (campaign UI, narration controls, source setup, bundled consent). Root inspected `/tmp/dm-speech-bundled-dialog.png` and confirmed readable layout without HF setup controls.
- `TMPDIR=/private/tmp npm run test:journal`: 1/1 passed in isolated temporary workspace/daemon; user's daemon was not stopped or reconfigured.
- `npm run typecheck`: passed.
- `DM_SPEECH_HOME=/tmp/dm-phonon-final.0tILOf npm run desktop:dist`: passed using previously prepared pinned assets. The speech bundle is approximately 105 MiB uncompressed.
- `TMPDIR=/private/tmp npm run desktop:smoke -- --launch`: passed against final packaged app. Fresh HOME, only bundled Node on PATH, empty HF cache and offline mode; synthetic campaign creation worked without Git, and Easton/Zoey returned valid WAVs (130604 / 134444 bytes). Actual Electron UI hid token setup, persisted Skip, reopened setup and enabled narration, closed the dialog, and answered worker IPC.
- Native leading-dash prose and cancellation tests passed. Native runtime real synthesis also worked without inherited credentials.
- DMG `hdiutil verify` and ZIP `unzip -t` passed. Bundled isomorphic-git license and third-party inventory are present. Speech resources are the explicit allowlist only.

## Artifacts and limitations
- `release/Dungeon Master-0.6.0-arm64.dmg`, approximately 320 MiB; SHA-256 `988a159e35ae2f0466fd803d729dc0972d345fcc1a7170e5a768cd2120e74d28`.
- `release/Dungeon Master-0.6.0-arm64.zip`, approximately 314 MiB; SHA-256 `4ba350d2e6d995bc6cb358778682670f0fa096be87f6ccc8ad07e14831629383`.

This remains an unsigned/unnotarized Apple silicon preview. Only the chosen DM provider and its own authentication/dependencies are external; local Ollama mode naturally needs its provider endpoint/model. No live provider/model calls were made for these checks. Signing/notarization, clean-machine public distribution validation, Intel/Windows/Linux targets and updates remain separate release work. The build requires maintainer preparation of model assets; this is not an end-user step.
