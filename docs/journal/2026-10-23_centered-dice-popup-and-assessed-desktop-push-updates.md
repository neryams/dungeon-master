# Centered dice popup and assessed desktop push updates

## Context and implemented change

User requested a centered dice popup and asked whether polling should become event-based. Updated `desktop/theme.css` to place the fixed popup at 50%/50% with a translate transform, preserving its foreground stacking and nonblocking dismissal behavior.

## Investigation and recommendation

`desktop/app.ts` refreshes campaign snapshots every 1000 ms. Desktop tool activity is written to the owner-bound activity file and read during host snapshots. The worker/main connection already uses child-process IPC; main/preload uses Electron IPC for request-response calls. Recommend pushing typed public activity notifications across the tool-to-worker boundary, then existing worker IPC and Electron main-to-renderer messaging, with initial/recovery snapshots. A renderer-only push conversion would leave the upstream polling problem. WebSockets add a network server unnecessarily for host-local communication. This migration was discussed, not implemented.

## Verification

`npm run build`, targeted Electron dice UI test (1 passed), `npm run typecheck`, and `git diff --check` passed. Inspected the regenerated `/tmp/dm-dice-feedback-ui.png` to verify placement. No behavior or transport changes were made; existing uncommitted work is preserved.

## Next steps

Restart Electron to load centered styling. Event-driven progress remains a recommended follow-up; no commits or pushes made.
