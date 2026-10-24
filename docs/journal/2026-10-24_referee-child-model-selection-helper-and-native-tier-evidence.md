# Referee child model selection helper and native tier evidence

## Context and decisions

The user reported that Antigravity actually invoked the referee with model inheritance even after skill text requested cost-aware selection. Investigation confirmed that agy models returns concrete parent-session catalogue IDs and display names only; those IDs are not valid invoke_subagent tier arguments. The installed CLI's bundled workflow documentation lists child tiers inherit, flash_lite, flash, and pro, and recommends lighter tiers for simple work. Routine referee review should explicitly use flash; flash_lite fits particularly simple reviews. No verified dollar prices or precise latency measurements were found.

## Completed changes

- Added src/desktop/referee-model.ts with a pure selector and explicit delegate instruction. Antigravity selects flash (then flash_lite) only when the exact native child option is advertised. Codex selects a concrete child ID only when host metadata explicitly says it is fast, lower-cost and sufficient for rules checking. Unknown or unsupported choices fall back to inherit. Ollama pins its current local model or local inheritance and explicitly prevents hosted switching.
- Added seven tests in test/referee-model.test.mjs covering exact advertised tier/ID selection, refusal to treat Antigravity catalogue IDs as child tiers, unsupported/unknown metadata fallback, and local provider isolation.
- Updated the run-campaign and rules-referee skills/protocol to delegate immediately after prepare_action, let the referee fetch missing rules, explicitly select an advertised faster child model, preserve one referee context for both stages, and reserve stronger escalation for a concrete complex/unresolved reason.

## Verification actually run

npm run typecheck passed. npm run build and the targeted node --test test/referee-model.test.mjs passed; 7/7 helper tests succeeded.

npm test was started as required by the repository instructions. It produced 179 passing tests, 2 failures, and 1 cancelled suite before being interrupted after the synthetic setup suite remained stalled for over two minutes. The reported failures were in test/codex.test.mjs (a symlink path rejected as unsafe) and test/hotseat-setup.test.mjs (temporary directory cleanup returned ENOTEMPTY and the suite left a pending promise). These failures are outside the helper test and need review against the concurrent desktop changes.

## Limitations and next steps

The pure helper is not yet called by the active desktop host; connect-time host integration should pass only native delegation options, retain the selection for comparable actions, splice the returned instruction into the referee delegation prompt and pass the returned model value to invoke_subagent. Antigravity child option discovery is not exposed by agy models or agy --help; use the installed native workflow capability evidence once, not a per-turn CLI probe. No campaigns were touched, no model API calls were made, and no commit was created.