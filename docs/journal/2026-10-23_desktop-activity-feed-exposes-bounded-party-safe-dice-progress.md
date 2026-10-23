# Desktop activity feed exposes bounded party-safe dice progress

## Context
The Electron hotseat needs temporary dice and operation feedback without changing the ChatGPT/Codex campaign plugin or adding progress details to durable campaign history.

## Decisions and rationale
- Store the feed in `.dm/hotseat/activity.json`, bound to the current desktop owner token.
- Keep the desktop MCP server as the sole writer after owner establishment; the host resets the feed for a new owner and reads it with pending-request phase filtering.
- Parse supported tool inputs before showing feedback. Use only fixed generic progress phases and a strict whitelist for public roll labels.
- Render numeric dice only from matching committed events marked party-visible. Preserve operation IDs for retry deduplication; report failed rolls without invented totals.

## Completed changes
- Added `src/desktop/activity.ts` for owner-bound, capped ephemeral feed reads and writes.
- Extended `CampaignSnapshot` with optional activity metadata and integrated the feed through `src/desktop/server.ts` and `src/desktop/host.ts`.
- Added `test/desktop-activity.test.mjs` covering public and DM visibility, retry deduplication, admin-reported rolls, failed results, owner replacement, and concurrent starts.

## Verification
- `npx tsc -b tsconfig.json tsconfig.desktop.json` passed.
- `node --test test/desktop-activity.test.mjs` passed (3 tests).
- Full `npm run typecheck` was not confirmed in this subtask; a concurrent UI edit initially produced an implicit return-type error in `desktop/dice-feedback.ts`.

## Known limitations and next steps
- The activity feed is intentionally ephemeral and bounded; completed events remain the source for durable results.
- Run the full suite and typecheck once concurrent UI edits settle.