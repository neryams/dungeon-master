# Phonon 40M comparison runtime prepared awaiting model access

## Context and decision

The user preferred the small KittenTTS models over version 2 after listening, and requested trying https://huggingface.co/gradium/phonon-40m-en with the same passage. Checked the official model card and gradium-ai/xn-ptts documentation. Phonon 40M is gated and its weights use CC BY-NC 4.0; the separately available 31M English model uses Apache-2.0. Did not substitute 31M without asking the user.

## Completed work

Prepared an isolated Python 3.12 environment outside the repository with ptts 0.4.1, numpy, soundfile and Hugging Face tooling. Prepared a local comparison script using the same synthetic narration, Easton voice, q8 CPU inference, four threads and seed 42, recording first-chunk latency, total synthesis time and WAV duration. Planned downloads are commit-pinned and inference local. The script has not loaded a model or generated audio yet.

## Verification actually run

An unauthenticated HEAD request for the exact 40M weights returned HTTP 401 GatedRepo. The supported Hugging Face get_token() API reported no configured local login; no token value was displayed. Runtime import succeeded and reported ptts 0.4.1 with metal and cpu devices and supported quantizations. No model access restrictions were bypassed, no access terms accepted for the user, and no app source/dependencies or campaign records changed. App tests were not rerun for this preparation.

## Limitations and next steps

A user question is pending: accept access on the model page and authenticate local download tools, or choose an initial 31M sample. The 40M sample remains blocked on account access; runtime preparation is complete. After access is available, run the prepared local experiment, validate the waveform, present the playable sample and record actual timing. Evaluate noncommercial model terms separately from permissively licensed runtime code before app distribution. No commits or pushes made.
