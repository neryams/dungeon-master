# KittenTTS local narration feasibility and Electron playback design

## Context and decisions

The user requested fetching and pulling latest main, a fresh branch, and investigating KittenTTS narration in Electron. Requirements: read new DM responses during active campaigns only, persistent mute, immediate stop/skip, and per-message manual replay. Fast-forwarded main to c1628fd and created codex/desktop-text-to-speech. The starting checkout was clean. No commits or pushes were made.

This milestone is an investigation plus isolated working synthesis experiment, not an implementation of app controls. Read README.md, docs/architecture.md, related setup journal entry, current desktop/public transcript code and upstream documentation. A lower-cost subagent independently researched engine choices and reviewed the proposed integration boundaries.

Recommend evaluating KittenTTS v0.8 Nano INT8 first, with Mini as a listening comparison. Both run locally with the Python ONNX subset of kittenml 0.9.6; no hosted model API is involved. KittenTTS 2 was not installed or measured; it has different weight licensing and a larger runtime. The official Web/Node SDK is promising but npm view @kittentts/web returned E404. Its source c846fe92858f3447f4912226471f5a63983b3f94 requires Emscripten to build the phonemizer, unavailable on this machine. It was inspected only.

## Completed work

Added docs/text-to-speech-investigation.md with model/runtime tradeoffs, measured results, reproduction details, proposed UX, source integration points, and acceptance tests. No application source, event schema, dependencies, saved campaigns or existing journal daemon were changed.

Created an isolated temporary Python 3.12.8 environment and model cache outside the repository. Generated synthetic sample narration with Nano INT8 and Mini using Jasper at 24 kHz on Apple M3 Max with 48 GiB RAM, arm64 CPUExecutionProvider. Model revisions: Nano 84781d74e29ee25217551556398b42f80593a813; Mini c02725660cea441db4c383af69f1f26f5cd00947. Sample WAVs and results are local chat artifacts outside this public repository. No actual campaign content was used.

Proposed integration uses only saved public TableTurn.messages. Infer automatic eligibility from review mode at each publication event, not solely current snapshot mode: one polling update can include both setup messages and transition to play. Expose desktop-only eligibility metadata without rewriting events. Maintain an initial history baseline, observe messages while muted without queuing, and use playback generation tokens to reject stale results. Persist the narration preference in existing typed desktop preferences. Skip drops current message; mute clears all playback; manual replay is a one-off action that leaves the automatic preference unchanged. Speech worker and renderer audio are independent from Stop DM. Start with Electron host only to avoid LAN audio duplication.

## Verification actually run

- Fetched origin, switched main, pulled with --ff-only, created branch; main equals fetched c1628fd.
- Native local synthesis succeeded for two models and two synthetic texts each. WAV arrays were nonempty, finite and nonzero.
- Nano short sentence: 0.130 s synthesis / 4.32 s audio. Warm paragraph: 0.095 s first chunk, 0.505 s full synthesis / 18.76 s audio, five chunks.
- Mini short sentence: 0.198 s synthesis / 3.59 s audio. Warm paragraph: 0.173 s first chunk, 0.860 s full synthesis / 16.61 s audio, five chunks.
- Offline repository-name load initially failed because commit-pinned downloads did not create a main reference. Retested both with pinned local snapshot paths and HF_HUB_OFFLINE=1: passed. Fresh-process model load about 1.13 s Nano / 1.06 s Mini; load plus short sentence about 1.26 s each.
- Documentation formatted with Prettier; git diff --check passed.
- npm test, npm run typecheck and npm run test:journal were not run: this milestone changes documentation only. No app behavior was changed.

## Limitations and next steps

Single-run timing samples are not statistical benchmarks, audio-quality judgments, or Electron end-to-end latency. Imports/downloads/audio output delay are excluded. User listening comparison, fantasy vocabulary, lower-end hardware and contention with local DM inference remain untested. No TTS2 benchmark, JavaScript SDK build, runtime bundling, UI, mute persistence or cancellation implementation exists yet.

Implement and test a deterministic playback controller and controls using a fake engine, then a separate owned local synth process. Keep sentence chunking bounded for long messages rather than assuming this short paragraph represents all narration. Ensure skip/mute stays responsive during initialization and generation, old results never restart speech, setup-to-play filtering works within one poll, and initial history never autoplays. Run required unit/type checks, isolated journal integration and targeted Electron UI tests after behavior changes. Complete dependency/license review and model/runtime installation UX before distribution.
