# Phonon speech sidecar and pinned local setup implemented

## Context and decisions

The Electron narration work needs local English speech using the Phonon 40M model selected after the comparison sample. The runtime stays separate from campaign data and repository state. Model assets are installed only by an explicit setup command; runtime inference is offline and does not inherit Hugging Face credentials.

## Completed changes

- Added `src/desktop/speech-runtime.ts` with the `SpeechRuntime` API, deterministic external storage home, bounded one-at-a-time JSON protocol, persistent child ownership, hidden diagnostics, cancellation, lazy restart, and graceful missing-install status.
- Added `scripts/phonon-speech.py`, which supports one-time authenticated asset preparation and a persistent ptts streaming sidecar. It pins `ptts==0.4.1` at setup, the Phonon model revision `cc738b7e4d182c2ba1bafb8062aa4846af000637`, and downloads a revision-resolved voice catalog containing only Easton and Zoey. It emits mono PCM16 WAV in base64 and keeps stdout for protocol messages.
- Added `scripts/setup-speech.mjs`, using an isolated `uv` Python 3.12 environment with pinned direct dependencies and `DM_SPEECH_HOME` override.
- Added `test/speech-runtime.test.mjs` with fake-process tests for missing installs, validation, credential stripping, audio response, cancellation, and safe restart/reuse.

## Verification actually run

- `npm run typecheck` passed.
- `node --test test/speech-runtime.test.mjs` passed (2 tests).
- `npm test` built successfully and ran 145 tests: 143 passed. Two unrelated existing macOS failures remain: `test/cli.test.mjs` compared `/var/...` with `/private/var/...`; `test/codex.test.mjs` failed on a symlink rejection in a campaign fixture.
- A temporary external home was populated from the already cached sample assets and the sidecar synthesized an Easton WAV offline. The result was valid mono PCM16 at 24 kHz, 149,804 bytes, 3.12 seconds. No model or campaign asset was put in the repository.

## Known limitations and next steps

- The installer itself has not been run end-to-end because this environment already has an authenticated Phonon comparison setup; fresh `uv` installation and current Hugging Face catalog download remain unverified.
- Zoey's exact local asset was not available in the comparison cache, so actual synthesis was smoke-tested with Easton; fake protocol tests cover both accepted voice names.
- The 40M model remains CC BY-NC 4.0. It was explicitly selected for local use after the user enabled access; distribution decisions still need to preserve that model license boundary.
- The parent task owns Electron playback/UI integration and the combined journal follow-up.