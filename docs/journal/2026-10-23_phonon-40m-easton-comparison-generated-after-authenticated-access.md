# Phonon 40M Easton comparison generated after authenticated access

## Context and decision

The user chose to enable access to the requested Phonon 40M model rather than substitute 31M. Used the newly available hf-cli skill and the supported hf auth whoami command to verify local sign-in; it succeeded. Normal authenticated download then succeeded. This supersedes the access blocker in the preceding Phonon preparation entry. No access terms were accepted by the agent, credentials were not printed or saved in source, and no access restriction was bypassed.

## Completed work

Generated the same synthetic comparison paragraph used for KittenTTS v0.8 and v2, using Phonon 40M English's Easton preset voice (a different speaker from Kitten's Jasper). Used ptts 0.4.1, model gradium/phonon-40m-en pinned to cc738b7e4d182c2ba1bafb8062aa4846af000637, q8_0, CPU, four threads, seed 42 and English normalization on the M3 Max. Inference was local. The isolated environment, cache and generated WAV/metadata remain outside this public repository. The output is a chat audio artifact.

## Verification actually run

Streaming yielded 15 chunks. First chunk arrived in 0.0597 seconds; complete generation took 0.4458 seconds and produced 13.44 seconds of mono 24 kHz audio. Initial construction took 7.29 seconds including first-use downloads/setup; this is not a pure model load measurement. The waveform was verified nonempty, finite and nonzero; saved WAV was independently checked as mono PCM16, 24 kHz, 13.44 seconds.

## Limitations and next steps

This is one sample and not a statistical latency benchmark. Easton differs from Jasper and speaks this passage in a shorter duration, so compare the actual audio rather than treating timings as a controlled model-quality test. No listening quality or transcription accuracy claim was made. Phonon 40M retains CC BY-NC 4.0 model licensing, distinct from the permissive runtime. The user should compare the clip before engine selection. Electron narration controls remain unimplemented; no application source/dependencies, campaign records, or journal daemon configuration changed. No app test suites were rerun for the audio experiment. No commits or pushes made.
