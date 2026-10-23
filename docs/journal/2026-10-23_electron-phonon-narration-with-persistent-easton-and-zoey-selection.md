# Electron Phonon narration with persistent Easton and Zoey selection

## Context and decision

On branch `codex/desktop-text-to-speech`, based on main `c1628fd`, the user selected Phonon 40M after comparing local KittenTTS 0.8, KittenTTS 2 and Phonon samples, and requested both Easton and Zoey. Implemented the original campaign-only narration request with a persistent voice selector. Changes remain uncommitted; nothing pushed.

## Implemented

- `desktop/narration.ts` coordinates new-public-message playback, ordered prose chunks, skip, persistent automatic mute, explicit replay while muted, voice changes and campaign exit. Opening/reloading establishes a silent historical baseline. Setup publications are excluded from automatic playback even when setup ends in the same polling interval.
- `desktop/app.ts`, `desktop/index.html`, `desktop/app.css`, and `desktop/narration-audio.ts` add controls above the host transcript and small replay buttons under DM messages; save voice/mute to versioned Electron local storage; play in-memory WAV using sandboxed Web Audio. Switching voices stops current and queued reading. The host window permits audio autoplay; LAN windows are unchanged.
- `src/desktop/contracts.ts`, `desktop/preload.cts`, `desktop/main.mts`, and `src/desktop/host.ts` add validated speech/status/cancel requests. Speech accepts exact public message references, resolves text from current saved campaign state, rejects setup, and invalidates stale campaign/cancellation results. Reopening creates a fresh runtime after close.
- `src/desktop/speech-text.ts` derives publication eligibility from authoritative event mode and converts Markdown to bounded prose chunks. No campaign events, records, preferences or audio are rewritten or appended by speech.
- `src/desktop/speech-runtime.ts`, `scripts/phonon-speech.py`, and `scripts/setup-speech.mjs` supply a bounded owned local engine, pinned Phonon model and voice revisions, isolated Python dependencies, explicit installation through `npm run speech:setup`, offline inference and credential-free inference environment. Cancellation during asset checks/startup/synthesis rejects stale work and permits immediate replacement. Model assets live outside the source/campaign repositories.
- `docs/desktop.md` documents setup and behavior; `docs/architecture.md` documents trust/cancellation boundaries; original investigation is marked historical. `test:desktop` now includes narration UI coverage.

## Verification actually run

- `npm run typecheck`: passed.
- `TMPDIR=/private/tmp npm test`: 150/150 passed. Canonical temporary directory avoids existing macOS symlink-path assertions; no unrelated test semantics changed. An initially over-specific child-start-count assertion was replaced with observable cancellation/restart behavior.
- `TMPDIR=/private/tmp npm run test:journal`: 1/1 passed with the existing isolated temporary daemon harness. User daemon untouched.
- `TMPDIR=/private/tmp npm run test:desktop`: 2/2 passed, including Electron AudioContext playback, skip, mute/voice persistence across reload, setup hiding, historical baseline, muted new publications, automatic Zoey playback, and switching to Easton/replay.
- Real `npm run speech:setup` completed with the user's configured Hugging Face access. Real offline runtime synthesized valid WAVs for Easton (353324 bytes, ~1.24 s including cold engine startup) and Zoey (364844 bytes, ~0.23 s warm) for the same short synthetic English prose. These are smoke measurements, not broad performance benchmarks.
- Focused runtime/controller/projection/host tests, formatting checks, and `git diff --check` passed. Visually inspected `/tmp/dm-narration-controls.png`; controls fit the host conversation pane.

## Limits and next steps

Phonon 40M weights remain CC BY-NC 4.0; the app's MIT license does not change that. Weights are downloaded only through explicit setup and not bundled. English pronunciation of fantasy names remains model-dependent. Audio is synthesized in bounded prose parts before playback rather than forwarding native streaming frames. Automated UI tests use a deterministic local sidecar fixture; actual Phonon voices were separately smoke-tested. Relaunch the built desktop to try both voices with a live campaign; no hosted DM turn was needed for these checks.
