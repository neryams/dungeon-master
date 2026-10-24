# Turn pacing and cost-aware referee selection guidance updated

## Context and decisions
User requested three ordered steps: commit performance logging, then reduce unnecessary agent round trips, then have the main DM choose the referee model for speed and cost-effectiveness. Logging was committed separately as 66883f8 (Add private desktop turn performance diagnostics). This follow-up remains uncommitted for review.

## Implemented changes
skills/run-campaign/SKILL.md and skills/rules-referee/SKILL.md now allow direct reuse of fresh exact prepare_action/get_action packets, saved roll results and complete edition-matched rule excerpts. The DM reuses the same bounded referee through both review stages of one action when supported. Post-commit sheet/map retrieval is conditional on the response needing exact totals or geometry; successful writes do not need no-op probes. Entity replacement can use an already-current complete tool result. Narration follows saved mechanics promptly; scene/journal bookkeeping remains at meaningful boundaries afterward where supported. LocalMemoryGuard requirements remain unchanged.

The main DM selects a host-supported referee model prioritizing speed, cost-effectiveness and sufficient rules-checking capability; complex/inconclusive cases can escalate. Unsupported/unknown overrides fall back honestly to the host default/inherited model, and local mode stays within its configured provider. This is native host-agent guidance, not automatic routing or model API calls. Updated run/create/referee skills, protocol, src/referee-service.ts tool description, src/desktop/codex.ts instructions, README.md and architecture/desktop docs to remove conflicting same-model requirements.

src/desktop/host.ts now omits inline create-campaign skill during established hosted play, as local mode already did; workspace skills remain available. Added an Antigravity/Codex synthetic-host test verifying gameplay/referee/art guidance remains while inline setup guidance is omitted once a party exists outside setup mode.

## Verification actually run
npm test: 175 passing. npm run typecheck: passed. npm run test:journal: 1 passing in its isolated temporary workspace/daemon. Commands used canonical macOS TMPDIR=/private/tmp. git diff --check passed. Independent read-only subagent review found no remaining guard conflicts or new mandatory round trips.

## Limitations and next steps
No live gameplay or provider-inference benchmark was run. Model-choice instructions cannot guarantee that a given host supports overrides or that a smaller model is faster on a difficult ruling. Logging will provide evidence from subsequent turns. Restart/reconnect a development build to load updated workspace skills and provider instructions; an installed packaged app requires a rebuilt package. Review and commit this follow-up when desired; only the logging milestone was committed as explicitly requested. No push, campaign-data edits or daemon changes.
