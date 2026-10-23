# Desktop push recovery and acknowledgement ordering verified

## Context

Follow-up to `docs/journal/2026-10-23_desktop-owner-ipc-notifications-deliver-tool-activity-without-polling.md`. Review found that an always-initialized in-memory activity value prevented recovery snapshots from reading the disposable activity file. Socket acknowledgement could also precede host processing of a notification.

## Changes and rationale

`src/desktop/host.ts` now merges owner-checked activity-file recovery into live rolls during snapshots, preserving completed outcomes over stale rolling values. It emits an activity event only when recovery changes the live value. Host socket callbacks return their queued processing promise, so `src/desktop/activity-bus.ts` acknowledges after processing. The bus collects bounded bytes before UTF-8 decoding to handle split multibyte characters. Worker event forwarding tolerates an already closed IPC channel. Provider progress and stale connection errors are checked against campaign/generation identity before emitting status. LAN hosting start/stop emits changed events. Completed live roll notices are checked against committed party-visible roll events before display.

`test/desktop-activity.test.mjs` checks token rejection, endpoint cleanup, async acknowledgement, and split UTF-8 input. `test/hotseat.test.mjs` checks the real desktop MCP wrapper's rolling/completed events, merge of concurrent partial roll notices, rejection of an uncommitted result, and recovery of a completed roll after notification delivery is intentionally disabled.

## Verification

`npm run typecheck` passed. Targeted `node --test test/desktop-activity.test.mjs test/hotseat.test.mjs` passed (13 tests). The coordinating task is running the full suite and integrated UI tests. No shared journal daemon or campaign data was changed.

## Next steps

Review the integrated Electron bridge and renderer, then complete the full required checks. The activity file is recovery data within the current desktop owner; reopening establishes a new owner and clears stale feedback.