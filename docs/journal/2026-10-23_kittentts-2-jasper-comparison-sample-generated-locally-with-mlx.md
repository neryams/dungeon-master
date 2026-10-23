# KittenTTS 2 Jasper comparison sample generated locally with MLX

## Context and decision

The user confirmed whether the previous samples were v0.8 and requested a version 2 sample for comparison. Both earlier clips were v0.8 (Nano INT8 and Mini). Used exactly the same synthetic paragraph and Jasper voice for the new sample, with the stable preset and no added expression tags. This supplements the earlier investigation; its statement that TTS 2 had not yet been tested describes the previous milestone.

## Completed work

Created a separate temporary Python 3.12.8 environment outside the source repository with kittenml[mlx]==0.9.6. Loaded KittenML/kitten-tts-2 at revision 1f00fee525c7b2e30bbe9ca9ba67529734fce9c9 using the MLX backend on the Apple M3 Max. Used default packed weights, default decoder, Jasper, stable preset, and seed 42. Downloaded public model assets into an isolated local cache with implicit account tokens and Hugging Face telemetry disabled. No hosted inference API was called. Generated the comparison WAV as a local chat artifact outside the repository.

## Verification actually run

Jasper was present in the available voices. The generated waveform was nonempty, finite, and nonzero. Saved file was verified as mono PCM16 WAV at 24 kHz, 20.12 seconds long. Generation took 12.96 seconds after initialization. First-use initialization took 74.87 seconds after the explicit main model download; this includes imports and any additional first-use decoder setup/download and is not a warm-load benchmark. No claims about perceived audio quality were made without listening.

No application code or dependencies changed, and no campaign or existing daemon was touched. No app test suites were rerun for this audio experiment. Branch remains codex/desktop-text-to-speech based on c1628fd; no commit or push.

## Limitations and next steps

This is one first-generation timing, using the Mac GPU for the version 2 language model, while the v0.8 samples used CPU ONNX. It is a listening comparison, not a controlled backend performance comparison. The sample uses TTS 2's default chunk sizing and the earlier v0.8 sample yielded five chunks. User should compare the actual clips before choosing an engine. Electron speech controls, persistent mute and replay remain planned, not implemented. Further cold/warm startup, streaming, cancellation and packaging evaluation remains necessary before adopting version 2 in the app.
