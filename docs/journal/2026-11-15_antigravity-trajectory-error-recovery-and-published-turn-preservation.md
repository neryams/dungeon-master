# Antigravity trajectory error recovery and published turn preservation

## Context

Investigation of a live Antigravity hotseat failure (`Error: Antigravity did not complete the turn. Check CLI authentication, limits and campaign permissions; saved changes remain intact.`) traced the issue to an upstream behavior in `agy` 1.4 (`steps.BuildJSONOutput` -> `steps.LastStepError` -> `steps.LastRunErrorDetails`) combined with error handling in `src/desktop/antigravity.ts` and `src/desktop/host.ts` (at base commit `095b344`):

1. When a model emits a transient malformed function call mid-turn (recording a `CORTEX_STEP_TYPE_ERROR_MESSAGE` step in the conversation trajectory) and then recovers, completes tool calls, and emits a final `PLANNER_RESPONSE` (`step_type: "agent_response"`), `agy`'s `runTurn` (`postResponseFailure`) treats the turn as succeeded and calls `emitter.EmitFinal("SUCCESS")`.
2. However, `printmode.buildResultOutput` calls `steps.BuildJSONOutput` across the entire conversation trajectory (`allSteps`). Because `steps.LastRunErrorDetails` walks backward through all steps in the conversation without stopping at the current turn's `USER_INPUT` or `LastResponseBearingStepIndex`, any `ERROR_MESSAGE` step anywhere in the trajectory populates `out.Error` and leaves `out.Status = "ERROR"` in the final `result` stream event.
3. Furthermore, once an `ERROR_MESSAGE` step exists in a conversation's trajectory, every subsequent turn resuming `--conversation <id>` (including `DesktopHost.connect()`'s `campaign_status` readiness check) also receives `result.status = "ERROR"` even after succeeding and replying `READY`.
4. In `DesktopHost.resolveTurn`, only `AgentTimeoutError` preserved a turn as `completed` when `hasPublishedResponse(turn)` was already `true`; any non-timeout provider error after a committed final `publish_table_message` (`delivery: "response"`) marked the turn `interrupted`.

Note: `project_journal` MCP tools were not loaded in this session, so this entry was written directly to `docs/journal/` as documented in `AGENTS.md`.

## Decisions and rationale

- In `AntigravitySession.receive` (`src/desktop/antigravity.ts`), track whether the turn's `step_update` stream ended with a non-empty `agent_response` step after any `tool` or `error_message` step (`endedWithAgentResponse`). Accept a `result` event with `status === 'ERROR'` when `endedWithAgentResponse` is true, `result.error` and `result.response` are non-empty strings, `finished_reason` is neither `'timeout'` nor `'interrupted'`, and the turn completed at least one tool or readiness check. Unrecovered errors at the end of a turn continue to fail closed.
- In `DesktopHost.connect` (`src/desktop/host.ts`), if resuming a cached Antigravity `conversationId` from `.dm/hotseat/session.json` fails during the connection check, close the failed session, remove the stale session locator, and retry the connection check once with a fresh conversation.
- In `DesktopHost.resolveTurn` (`src/desktop/host.ts`), preserve any turn that has already committed a final public response (`hasPublishedResponse(turn)`) as `status: 'completed'` (`table-finish-${input.id}`) even if the provider exits with a non-timeout error during post-publication cleanup, while still transitioning the host to `stage = 'attention'`.
- In `reduceTable` (`src/table.ts`), allow `finish` (`status: 'completed'`) to transition an `interrupted` turn to `completed` when `hasPublishedResponse(turn)` is already true, enabling append-only recovery through `CampaignStore.transact` without modifying saved events.

## Completed changes

- Updated `src/desktop/antigravity.ts` to track `endedWithAgentResponse` across `step_update` events and tolerate trajectory-poisoned `ERROR` result payloads when the turn completed tool work and ended with an `agent_response`.
- Updated `src/desktop/host.ts` to fall back to a fresh conversation when a resumed Antigravity connection check fails, and to mark turns with a committed final response as `completed` if follow-up provider execution fails.
- Updated `src/table.ts` to permit completing an `interrupted` turn that already has a published final response.
- Added unit and integration coverage in `test/antigravity-events.test.mjs` and `test/host-publication-timeout.test.mjs`.

## Verification actually run

- `TMPDIR=/private/tmp npm run typecheck`: passed.
- `TMPDIR=/private/tmp npm test`: passed all 256 tests (including `npm run build` and `scripts/build-desktop.mjs`).

## Known limitations and next steps

- If the desktop app is currently running an older build in memory, restart the desktop app (or reload after `npm run build`) so the main process picks up the updated `build/desktop/main.mjs` bundle.
