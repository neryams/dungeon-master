# Speech setup preserves the configured Hugging Face login

## Context and decision

The initial Phonon runtime milestone pinned local model/voice setup and used Hugging Face's supported `get_token()` API. Review found that setting a custom `HF_HOME` in the installer subprocess would mask the user's existing configured login.

## Completed change

Removed the preparation-time `HF_HOME` override. Setup now inherits the normal Hugging Face auth configuration and resolves credentials only through the supported library API. The inference sidecar continues to use a private storage-local `HF_HOME`, `HF_HUB_OFFLINE=1`, and an environment scrubbed of credentials.

## Verification actually run

`npm run typecheck` passed. `node --test test/speech-runtime.test.mjs` passed (2 tests).

## Limitations and next steps

The authenticated preparation/download flow still needs an end-to-end fresh-home run. No credentials were printed or stored in the repository.