# Desktop dice activity integration verified through owned MCP wrapper

## Context
Follow-up validation expanded the activity feed from unit coverage to the live desktop MCP stdio wrapper and corrected request-scoped progress handling.

## Decisions and rationale
- Phase reads now receive the active request ID per snapshot, so overlapping snapshot consumers do not share mutable request state.
- After tool execution, the committed roll event supplies purpose and mode along with result values; pending input is used only for the transient roll start.
- Public labels come only from an exact whitelist. Non-whitelisted purposes and administrative details remain generic.

## Completed changes
- Added a real process-level `roll_dice` call against `dist/desktop/server.js` in `test/hotseat.test.mjs`, verifying the owner-bound feed receives the committed public result.
- Added request A/B phase filtering and rules-versus-notes phase coverage.
- Updated the desktop turn prompt to request concise public roll purposes and `visibility=dm` for hidden rolls.
- Added an uncertain-acknowledgement case proving a committed roll remains complete after a tool error.

## Verification
- `npm run typecheck` passed.
- `npm run build` passed.
- `node --test test/desktop-activity.test.mjs test/hotseat.test.mjs` passed (12 tests).

## Known limitations and next steps
- Full-suite and isolated journal integration verification remain with the coordinating task.