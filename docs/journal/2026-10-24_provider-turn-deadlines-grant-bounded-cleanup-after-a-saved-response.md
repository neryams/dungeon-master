# Provider turn deadlines grant bounded cleanup after a saved response

## Context

Live timeout investigation showed the Codex and Antigravity adapters could kill an active provider turn at the fixed absolute deadline even after the table had saved its final public response. The desktop host now supplies an authoritative response lookup and handles the typed timeout failure.

## Decisions and rationale

- Share deadline behavior in `src/desktop/turn-deadline.ts` so both providers apply the same lifecycle.
- At the existing provider deadline, check `hasPublishedResponse(requestId)` for at most one second. If no response is confirmed, fail with `AgentTimeoutError`.
- If a final response is confirmed, grant one finishing grace window, defaulting to 90 seconds. Progress and timing callbacks report that window.
- Cancel the controller on provider completion and session close; cancel also wins while the authoritative lookup is still pending.

## Completed changes

- Added `TurnDeadline` and `AgentTimeoutError`.
- Wired both `CodexSession` and `AntigravitySession` run/close lifecycles to the shared controller, with optional `hasPublishedResponse` and `finishingGraceMs` settings.
- Added the `provider-finishing-grace` timing event and progress message.
- Added `test/turn-deadline.test.mjs` for expiry without a response, single grace, cancellation during lookup, and typed timeout behavior.

## Verification actually run

- `TMPDIR=/private/tmp npm run typecheck`: passed.
- `TMPDIR=/private/tmp npm run build`: passed.
- `TMPDIR=/private/tmp node --test test/turn-deadline.test.mjs`: 4 passed.
- `TMPDIR=/private/tmp node --test test/codex.test.mjs test/antigravity-events.test.mjs test/host-publication-timeout.test.mjs`: 30 passed.

## Known limitations and next steps

- The host callback must remain authoritative and identify a completed response rather than an in-progress publication.
- The finishing grace is a single window; it does not restart if further activity occurs.
