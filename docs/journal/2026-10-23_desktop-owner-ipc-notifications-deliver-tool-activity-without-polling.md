# Desktop owner IPC notifications deliver tool activity without polling

## Context and decision

The desktop MCP wrapper previously saved an owner-bound activity file that the host read on periodic snapshots. This missed short-lived rolling phases. The desktop worker already had child-process IPC, so a local owner-scoped Node socket supplies the missing tool-to-worker notification boundary. The disposable file remains for recovery. The LAN and plugin contracts, campaign event schema, and authoritative CampaignStore transactions are unchanged.

## Implemented changes

- `src/desktop/activity-bus.ts` creates a private temporary Unix socket (or random Windows named pipe), validates bounded messages and owner tokens, and closes endpoints with the campaign.
- `src/desktop/activity.ts` reports each saved sanitized activity snapshot. `src/desktop/server.ts` sends activity before/after owned tool execution and a changed notice after each result. Messages contain only fixed phases, allowlisted roll labels/results, request IDs, operation IDs, and the owner token; no raw tool input or logs.
- `src/desktop/host.ts` advertises the endpoint in `owner.json`, merges concurrent roll notices by operation ID, keeps committed results over stale rolling notices, emits activity and changed events with current stage/detail and a monotonically increasing sequence, and cleans up the endpoint on close. Snapshots carry an activity sequence captured before state I/O so later events outrank a stale read.
- `src/desktop/worker.ts` forwards unsolicited typed events over existing process IPC. `src/desktop/contracts.ts` defines the event and desktop onUpdate callback contract.
- Tests cover token rejection/endpoint cleanup, live MCP rolling/completed notices, and concurrent roll merging.

## Verification

`npm run typecheck` passed. `node --test test/desktop-activity.test.mjs test/hotseat.test.mjs` passed (13 tests). Full suite and UI integration are being run by the coordinating task. No campaign data or shared journal daemon was touched.

## Known limits and next steps

The socket is best-effort display feedback; the event history remains authoritative. A future desktop session creates a fresh endpoint and reads the existing activity file for recovery. Review the integrated Electron renderer and run the full required verification before committing.