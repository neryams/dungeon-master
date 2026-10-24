# Publication-aware desktop timeout and progress integration verified

## Context and decisions
A desktop turn had reached the absolute provider deadline after saving its public response. Tool execution time was a small part of the total; main-agent orchestration and redundant serial rule retrieval dominated. Preserve event authority and never replay saved mechanics. Logging was previously committed as 66883f8; subsequent changes remain uncommitted.

## Implemented
- `src/desktop/turn-deadline.ts` gives final-response publication one bounded 90-second finishing window after the normal ten-minute deadline. The authoritative publication read is bounded to one second. Both CLI adapters cancel deadlines on completion/close.
- `src/desktop/host.ts` classifies typed deadline failures after saved final responses as completed public turns, preserves player choices, disconnects with a follow-up timeout notice, and never automatically replays work. Other failures and progress-only turns remain interrupted.
- `publish_table_message` supports optional delivery=progress/response through typed events. Legacy/omitted delivery remains a response. Progress cannot activate a player prompt or complete a turn. Desktop/LAN show an in-progress label; existing speech handles deliberate progress prose.
- Skills delegate immediately after prepare_action and allow one or two optional public story beats. Mechanical outcomes remain saved before publication. Local memory requirements remain intact.
- Antigravity parser now handles observed ACTIVE/DONE step indexes and duration_seconds, deduplicates events, and rejects failed readiness evidence. Timing metadata includes safe native child model values, including inherit, when actually supplied; no prompts/results are logged. Progress and final publication markers remain distinct.

## Referee model evidence and limitation
Installed native workflow documentation supports agent(model="flash"), not an established Model override on invoke_subagent. A native invocation smoke used Role/TypeName and omitted the requested model. Two isolated bounded workflow probes advertised run_workflow but returned without executing it. Thus faster-model execution and end-to-end speed improvement are NOT verified. Provider guidance now conditions the flash workflow preference on active native support and uses an honest inherited fallback. Do not conflate the main-model catalogue with child-tier values. No campaign was used or changed in these probes.

## Verification
Full npm test passed 197 tests before final workflow-guidance corrections. npm run typecheck passed. TMPDIR=/private/tmp npm run test:journal passed against an isolated daemon. Focused host timeout, progress, timing/parser, model-selection, and deterministic mock-timer deadline tests passed; backend timing test additionally verifies progress does not consume the final-publication marker. Formatting and git diff --check passed. Final guidance-specific checks follow.

## Next steps
Restart the development desktop/reconnect to use the built changes. Inspect the next actual turn's timing logs for native workflow execution and wall time; do not claim flash is active until that execution is observed. No running user campaign or shared journal daemon was stopped.