# Phonon direct bundling feasibility and redistribution distinction

## Context and findings
User asked how to bundle Phonon directly after the optional downloader installer was delivered. Current installer still downloads from Hugging Face per user. That is an implementation choice and must not be presented as a universal requirement of the model license.

Verified public sources: https://huggingface.co/gradium/phonon-40m-en identifies CC BY-NC 4.0; https://creativecommons.org/licenses/by-nc/4.0/legalcode.en section 2(a)(1) permits noncommercial reproduction/sharing, section 2(a)(5) offers downstream license rights, and section 3 requires retained attribution/notices/license and disclosure of modifications. HF gating governs access to upstream downloads; additional separately accepted access terms must be reviewed before public redistribution. Noncommercial constraints apply to the distributor's use as well as recipients; free price alone is insufficient.

## Recommended implementation, not yet implemented
Bundle pinned model/tokenizer/config and Easton/Zoey plus an architecture-specific speech runtime in Electron resources, retain full component notices and provenance, load local resource paths, and remove end-user HF token setup for that bundle. Keep optional narration acknowledgement/disable behavior. Original code stays MIT with clear separate model licensing.

Upstream model card links resolve to https://github.com/gradium-ai/xn-ptts/releases (some existing notices refer to gradium-ai/phonon, which returned 404). The v0.4.0 release provides standalone macOS arm64 and x64 ptts binaries; evaluate a persistent native helper before copying a development Python virtualenv. Native runtime migration is a proposal and has not been compatibility/performance tested. Current tested model+voice directories occupy approximately 73 MiB excluding the Python environment.

## Verification and next steps
Read current preparation/runtime code, pinned cached model card, official CC license and upstream release docs. No application code or installer behavior changed, no new build/test suite was run, and nothing was published. Next implementation should validate the selected runtime, package explicit assets without HF caches/credentials, update inaccurate upstream links, test fully offline on a fresh profile, and complete signing/notarization for public release.
