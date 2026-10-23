# Electron narration: KittenTTS investigation

Investigated October 22, 2026 (America/Chicago), starting from `main` at
`c1628fd` on `codex/desktop-text-to-speech`. This is a feasibility spike and
implementation proposal. The original findings below are historical: subsequent
KittenTTS 2 and Phonon samples are recorded in `docs/journal/2026-10-23_*`.
The selected implementation now uses **Phonon 40M with Easton and Zoey**;
see [desktop narration](desktop.md#dm-narration) for setup and controls.

## Recommendation

Prototype with the local KittenTTS v0.8 ONNX models, initially Nano INT8. Mini
also performed well on the development Mac and is worth comparing by ear.
Keep the speech engine behind a small adapter so the runtime or model can change.
Use a separate owned synthesis process, with playback and controls in the
renderer. Do not block campaign processing on speech.

The latest KittenTTS 2 is a different model family. It offers expression and voice
cloning, but has a larger runtime and separately licensed weights. Its repository
code is Apache-2.0; the weights use the Stellon Labs Community License. That
distinction makes it a poor automatic default for this open-source application
before a separate evaluation. This spike did not install or benchmark TTS 2.
See the [upstream models](https://github.com/KittenML/KittenTTS),
[ONNX guide](https://github.com/KittenML/KittenTTS/blob/main/docs/onnx-models.md),
[Nano INT8 model](https://huggingface.co/KittenML/kitten-tts-nano-0.8-int8),
[Mini model](https://huggingface.co/KittenML/kitten-tts-mini-0.8), and
[TTS 2 license](https://huggingface.co/KittenML/kitten-tts-2/blob/main/LICENSE.md).

The official [Web/Node SDK](https://github.com/KittenML/KittenTTS-web) is potentially
a better packaging fit than Python. However, `npm view @kittentts/web` returned
E404 from the public registry during this investigation. Its source at
`c846fe92858f3447f4912226471f5a63983b3f94` requires Emscripten to build its
phonemizer, which was not installed here. Do not add an unresolved npm dependency.
If adopting it later, disable its default analytics (`analytics: false`) and bundle
the matching ONNX wasm assets instead of relying on its default CDN. This SDK was
inspected, not built or benchmarked.

## Local experiment

An isolated temporary Python 3.12.8 environment ran `kittenml==0.9.6` with only
the documented ONNX dependencies. No repository dependency, global Python
environment, campaign, or journal daemon was changed. Models were downloaded
without an account token into the experiment's own cache. Speech inference was
local; no narration was submitted to a hosted API.

Hardware: Apple M3 Max, 48 GiB RAM, arm64. ONNX Runtime 1.31.0 reported
`CPUExecutionProvider`. Voice: Jasper, default speed, 24 kHz output. The long
sample used the public `generate_stream()` method and yielded five chunks.

| Measurement                                 | Nano INT8 v0.8 | Mini v0.8 |
| ------------------------------------------- | -------------: | --------: |
| Model load, excluding imports/download      |         2.18 s |    1.07 s |
| First short sentence synthesis              |        0.130 s |   0.198 s |
| Short sentence audio length                 |         4.32 s |    3.59 s |
| Paragraph first chunk, model already loaded |        0.095 s |   0.173 s |
| Entire paragraph synthesis                  |        0.505 s |   0.860 s |
| Paragraph audio length                      |        18.76 s |   16.61 s |

These are single-run feasibility measurements, not statistical benchmarks or
Electron playback latency. The paragraph ran after the first sentence, so its
timings reflect a warm model. Download time, imports, renderer scheduling and
audio-device startup are excluded. No claim is made about lower-end machines,
voice quality, fantasy-name pronunciation, or contention with a local DM model.
Generated WAV files were checked for nonempty, finite, nonzero samples. Listening
and end-to-end Electron testing remain necessary.

The original synthetic sample was:

> Beyond the archway, a silver bell rings once. The innkeeper lowers her voice.
> Someone has opened the sealed crypt beneath the village. Rain rattles against
> the shutters, and a fresh trail of muddy footprints leads toward the cellar.
> What would you like to do?

Pinned model revisions used:

- `KittenML/kitten-tts-nano-0.8-int8`: `84781d74e29ee25217551556398b42f80593a813`
- `KittenML/kitten-tts-mini-0.8`: `c02725660cea441db4c383af69f1f26f5cd00947`

For reproduction, create a separate Python 3.12 virtual environment outside this
repository, install `kittenml==0.9.6 --no-deps`, then `onnxruntime==1.31.0`,
`espeakng_loader==0.2.4`, `phonemizer==3.4.0`, `soundfile==0.14.0`,
`numpy==2.5.4`, and `huggingface_hub==2.2.0`. Resolve the exact model revisions with
`snapshot_download`, including `config.json`, `*.onnx`, and `*.npz`, then pass the
returned **local snapshot directory** to `KittenTTS(path, backend="cpu")`.
Measure `generate_stream(text, voice="Jasper", clean_text=False)` and write
concatenated samples at 24,000 Hz. The minimal install deliberately omits the
full package's TTS 2 dependencies; lock and test that subset before shipping it.

Offline loading must use that local snapshot path. Loading by repository name
with `HF_HUB_OFFLINE=1` failed after a commit-pinned download because the cache
did not have a `main` reference. Passing the pinned local path avoids the lookup.
Both models then successfully loaded and synthesized with Hugging Face offline
mode enabled. Fresh-process model load was 1.13 s for Nano and 1.06 s for Mini;
loading plus synthesizing the short sentence took about 1.26 s for each.

## Proposed user experience

- Narration defaults on once the local engine is available. New public DM
  messages are queued in publication order during active play. Setup remains
  silent, including automatic introductory messages.
- A persistent toolbar contains **Skip reading** and **Mute narration**. Skip
  stops the current message, including its unplayed chunks, and advances to the
  next queued message. It must remain usable while speech is being prepared.
  It does not invoke the existing **Stop DM** action or interrupt gameplay.
- Mute stops playback immediately, clears the queue, invalidates pending
  synthesis, and persists the disabled preference. Subsequent messages stay
  silent across campaign changes and app restarts until narration is enabled.
  Re-enabling starts with future messages; it does not read a backlog.
- Each public DM message gets a small **Read aloud** button below its body in
  the play view. It replaces current playback with that message. Proposed
  behavior while muted: this explicit action plays once without changing the
  saved automatic-narration preference. Setup view has no speech playback.
- Opening/reopening a campaign establishes a baseline of existing messages;
  history never autoplays. Leaving the campaign, switching campaigns, closing
  the window, or returning to setup stops all playback and drops pending work.
- Show a small preparing/reading/error status near the controls. Missing models,
  installation failures, or playback failures leave text gameplay functional.
  Do not silently switch to a cloud or operating-system speech service.

Keep the narration toggle in the existing typed desktop preferences and
`userData/table-preferences.json`, avoiding a second settings store. It is a device
preference, not campaign state. Manual playback should not silently change it.
For a trial, a documented separate runtime installation is acceptable; a shipped
feature needs an in-app model preparation flow and reliable runtime packaging.

## Integration points and correctness

`src/desktop/host.ts` publishes snapshots with the saved public `table` transcript;
`desktop/app.ts` renders it in `renderTranscript()`. Use those messages, not raw
provider deltas, tool results, reasoning, or referee records. Messages already
have event revisions and enclosing turn IDs. A stable playback identity can be
campaign ID/root + turn ID + message revision. Polling and rerenders must not
repeat speech. Playback should start when the published message appears, even if
the enclosing turn has not yet finished.

The current snapshot's `reviewMode` alone is insufficient. One poll may observe
setup messages followed by a transition to reviewed play. Determine automatic
speech eligibility from the mode **at each publication event**, using the
authoritative history already returned by `CampaignStore.read()`. Expose that as
desktop-only projection metadata. This also handles interrupted setup and mode
changes without modifying existing events or adding a schema migration. An
opening published after the transition is eligible; earlier setup text is not.
Legacy campaigns can use the existing active-play treatment. Manual replay of
historical DM messages is available only while the current view is active play.

Track newly observed messages independently of DOM rebuilds, including while
muted or in setup, so enabling narration cannot replay skipped messages.
`showCampaign()`, `refresh()`, and navigation in `desktop/app.ts` are the relevant
lifecycle hooks. Include campaign/view identity on asynchronous snapshot and audio
results to reject responses from a previous screen or campaign.

Proposed runtime responsibilities:

1. Main process owns a dedicated synthesis child and narrow validated IPC through
   `src/desktop/contracts.ts` and `desktop/preload.cts`. It accepts a message
   reference, resolves public saved text, and bounds work/output. It must not
   expose arbitrary executable paths, filesystem reads, or arbitrary HTTP calls.
2. The child loads the pinned model once and yields bounded PCM/WAV sentence
   chunks through an ID-tagged protocol. Keep logs separate from protocol output;
   the Python library's non-streaming `generate()` prints input text. Do not log
   campaign narration or inherit unrelated credentials into the child.
3. The renderer plays only chunks matching the current playback generation. Stop
   the audio source immediately on skip/mute. Late synthesis must never restart
   playback. A separate process permits hard cancellation if needed; retaining
   the model and discarding a stale in-flight chunk may reduce reload delay.
   Limit prefetching so obsolete requests cannot accumulate.
4. Use rendered Markdown text with preserved paragraph/list boundaries for
   narration. Exclude UI labels, revision numbers, buttons and code blocks;
   handle dice expressions and abbreviations deliberately. Do not read raw
   Markdown punctuation or scrape an entire message element after adding controls.
5. Keep cached models/runtime outside the source tree and campaign records.
   Dispose audio buffers/URLs after playback. If Blob-based audio is used, add
   only the needed `media-src blob:` CSP permission in `desktop/index.html`;
   keep `connect-src 'none'` in the renderer. Model downloads belong to a separate
   preparation step, not the middle of a narrated message.

This first version should speak only on the Electron host. Mirroring playback on
LAN clients would create overlapping voices at the table and needs separate
per-device controls. The existing LAN transcript and campaign tools need no new
speech behavior.

## Implementation and verification still to do

Implement the playback state machine and UI against a fake speech adapter first,
then connect the local engine. This makes mute and cancellation semantics
testable without model downloads or timing-dependent audio tests.

Required cases: initial history; repeated polls; several new messages; setup to
play in a single poll; publication before/after that transition; interrupted
turns; skip during preparation/playback; mute during preparation/playback; mute
and restart; re-enable with no backlog; explicit replay while muted; rapid replay
replacement; campaign switching; stale snapshots/chunks; missing engine/model;
child failure; renderer playback rejection; Markdown and empty narration.

Add focused tests for the event-derived eligibility projection and runtime
lifecycle, and Electron UI tests for controls, preference persistence and
responsive cancellation. Run `npm test`, `npm run typecheck`, and the isolated
`npm run test:journal` after behavioral implementation. No app behavior changed
in this investigation, and those suites were not rerun for this documentation
change.
