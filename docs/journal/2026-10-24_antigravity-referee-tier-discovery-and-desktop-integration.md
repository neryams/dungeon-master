# Antigravity referee tier discovery and desktop integration

## Context and decisions

The earlier referee model helper note left desktop prompt integration as a next step. The installed Antigravity workflow guide is the supported source for child tier names; the parent-session agy models catalogue does not advertise invoke_subagent child tiers. Because CLI versions vary, the host must confirm installed guide metadata at connection time before selecting a faster tier. Missing or unrecognized guide metadata leaves the referee on inherited model and tells the DM to set Model: "flash" only if the native tool options explicitly list it.

## Implemented changes

- Added bounded Antigravity capability discovery in src/desktop/referee-model.ts. It reads only the installed workflow skill file (up to 64 KiB), recognizes the model-tier argument entry, caches by path/size/mtime, and accepts only known exact child-tier values. It does not invoke the CLI or query the model catalogue on gameplay turns.
- Connected that result in src/desktop/host.ts. When the installed guide confirms flash, the per-request DM contract explicitly says to set invoke_subagent Model: "flash". Codex receives instructions to inspect native delegation options once per connection and use an exact fast/efficient option only when its metadata supports rules and effect checking; Ollama stays on its selected local model and cannot switch hosted.
- Kept delegation pacing and public progress-beat details in the run-campaign skill rather than duplicating them in the desktop prompt. The host prompt only carries provider-specific model selection guidance.

## Verification actually run

npm run typecheck, npm run build, targeted Antigravity activity tests, and 9 referee-model tests passed. The real installed workflow guide was read-only checked; it produced flash, flash_lite and pro, with flash selected. git diff --check passed. No full suite was rerun after this integration because the parent is running it after the shared changes settle.

## Limitations and next steps

Codex child-model choices are still resolved by the agent from the native delegation model options because the app-server catalogue is not guaranteed to describe the separate child-model parameter. No campaign data or shared daemon was touched. No model API calls or commits were made.