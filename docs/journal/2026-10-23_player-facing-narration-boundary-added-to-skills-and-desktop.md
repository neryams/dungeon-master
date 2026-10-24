# Player-facing narration boundary added to skills and desktop

## Context and decision

The existing run-campaign skill separated party facts from rumors and plans and defaulted rolls to party visibility, but it did not consistently distinguish perception from interpretation, testimony from truth, player theories from confirmation, or observable leads from hidden solutions. Desktop provider instructions also needed the same concise narration boundary. Preserve the normal public dice flow and protect secrets that make discovery rewarding.

## Completed changes

- Added a player-facing narration section to `skills/run-campaign/SKILL.md`: evidence before conclusion; attribute claims and theories; treat plans as future possibilities; allow varied earned discovery methods; offer suggestions only on request or when players are stuck; warn about apparent risk without predicting hidden outcomes; keep operational metadata out of fictional narration; make a roll private only when its existence or result would reveal a secret, keeping the reason private.
- Aligned campaign creation and session recap skills with evidence-based openings and knowledge-faithful recaps.
- Integrated the event-backed knowledge API contract into run-campaign guidance: `knowledgeFacts`, `truthKind`, nonbinding `discoveryHints`, `disclosures`, `knowledgeFactIds`, and `get_campaign_knowledge`.
- Added shared desktop guidance in `src/desktop/narration-guidance.ts` and included it in `DesktopHost`'s system prompt. The host prompt applies across Codex and Antigravity, so no duplicate provider-specific paragraph was needed.

## Verification

Inspected the three updated skills and desktop prompt changes with Git diff. No tests or typecheck were run in this subtask; parent task owns integrated validation.

## Limitations and next steps

Narration instructions guide model behavior but cannot guarantee secrecy when hidden information is in narrator context or prevent public prose from accidentally disclosing it. The ledger API contract is being implemented in parallel; validate the assembled tool/skill integration in the parent task.