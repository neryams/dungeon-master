# Phonon 31M and 40M matched Easton and Zoey comparison samples

## Context and decision

The user requested trying Phonon 31M after discussing fresh-install distribution and 40M's noncommercial license. This milestone generates comparison audio only; it does not select a new engine or change the app's current 40M setup.

## Completed investigation

Read current upstream model card at https://huggingface.co/gradium/phonon-31m-en, confirming Apache-2.0 metadata. `hf models info` reported `gated: false` and revision `92741c5b07d085ff840e26fea8ce43110b87852f`. Downloaded the pinned config, tokenizer, q8 model, default voice and README using `hf download` with implicit authentication disabled into a temporary experiment directory outside this repository. Reused already installed ptts 0.4.1 and the pinned Easton/Zoey voice assets. No application source, dependencies, campaign records or running services changed.

Generated four matched samples, 31M and 40M with Easton and Zoey, using the earlier synthetic crypt/innkeeper paragraph, CPU q8_0, four threads, seed 42 and identical default generation settings. Inference ran with HF_HUB_OFFLINE=1 against explicit local paths. Output directory: `/Users/ray/.codex/visualizations/2026/10/23/01a16660-ae9a-7db0-bfe5-0aea622f0d7e/phonon-comparison/`. Files are `phonon-31m-easton.wav`, `phonon-31m-zoey.wav`, `phonon-40m-easton.wav`, `phonon-40m-zoey.wav`, with full provenance/timings in `measurements.json`. Reproduction script is `/tmp/dungeon-tts-spike.n76xSP/compare-phonon-sizes.py`.

## Verification actually run

All four outputs had nonempty finite nonsilent samples, valid mono PCM16 WAV headers, 24 kHz sample rate and matching frame counts. 31M Easton: 13.52 s audio, 0.379 s generation, 0.028 s first chunk. 31M Zoey: 14.88 s audio, 0.410 s generation, 0.029 s first chunk. 40M Easton: 13.44 s audio, 0.402 s generation, 0.039 s first chunk. 40M Zoey: 14.72 s audio, 0.432 s generation, 0.039 s first chunk. First-chunk figures are engine measurements, not Electron end-to-end latency. These single-run smoke timings are not rigorous performance benchmarks. No behavioral code changes, so npm suites were not rerun.

## Limits and next steps

Speech quality is for the user to compare by ear; waveform validity does not establish correct pronunciation or preference. App remains on Phonon 40M until a model choice is made. A 31M decision would require updating pinned setup assets, removing the unnecessary gated-login requirement for that model, and implementing/discussing fresh-install runtime/model packaging separately. No commit or push performed.
