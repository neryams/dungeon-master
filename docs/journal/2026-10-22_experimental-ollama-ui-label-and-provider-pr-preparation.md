# Experimental Ollama UI label and provider PR preparation

## Context and decision

The user explicitly requested marking Ollama experimental in the UI, then committing, pushing and opening a pull request. This authorizes publication of the current provider implementation and its related engineering notes. Artwork generation and the proposed Mac/model reliability improvements remain future work.

## Completed changes

The provider dropdown in desktop/index.html now reads Local · Ollama + Codex CLI (Experimental), making the status visible before selection. The local settings already explain that model reliability varies. The pending commit includes the local adapter, memory and compaction safeguards, model/hardware configuration, scoped image transport compatibility, tests and documentation recorded in the preceding implementation entry. The branch also contains the previously committed Codex adapter at d47ca3a.

Fetched origin/main and confirmed it remains at 0d6e281 with no new commits requiring integration. No existing PR was found for feat/codex-electron-adapter. The planned PR targets main and describes both providers, preserving existing plugin/Antigravity behavior and clearly separating proven transport behavior from model quality.

## Verification actually run

For this publication pass: npm test passed all 108 tests; npm run typecheck, npm run test:desktop, npm run format:check and git diff --check passed. Earlier checks in this same implementation remain documented in docs/verification.md: isolated journal integration, LAN browser smoke, packaging, previous hosted-provider live scenarios and the successful tuned-Qwen offline 64k smoke. Those live model tests were not rerun for the UI label. No existing journal daemon was stopped or reconfigured.

## Known limitations and next steps

Ollama remains experimental. The tuned 9B model passed one 64k offline smoke including explicit compaction and restart; earlier runs failed, and successful sustained gameplay through automatic compaction is still outstanding. Local artwork generation, Mac runtime verification and independent referee quality remain unimplemented or unverified. Hardware estimates are advisory.

Next authorized steps are to commit this reviewed change set, push feat/codex-electron-adapter, create the PR against main and attach its URL to the task. This entry records preparation, not a claim that the push or PR creation has already succeeded. CI and reviewer feedback should be checked before merge; merging is outside this request.
