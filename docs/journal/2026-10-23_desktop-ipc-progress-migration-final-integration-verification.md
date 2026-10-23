# Desktop IPC progress migration final integration verification

## Context and decisions

At the user's explicit request, committed the centered dice popup and activity feedback implementation as `c45105b` on `codex/desktop-dice-feedback`, then implemented the IPC follow-up. The new messaging changes remain uncommitted; nothing was pushed.

## Completed integration

- `src/desktop/activity-bus.ts` provides an owner-token-authenticated local Unix socket / Windows named pipe with bounded messages, bounded waits, acknowledgement after handling, and lifecycle cleanup. The desktop tool wrapper notifies the worker directly; no WebSocket server, file watcher, or progress polling is used on the primary path.
- `DesktopHost` merges concurrent public rolls, checks complete results against events, scopes phases to requests, emits lifecycle changes, and recovers missed activity from the cache and authoritative roll events. Review fixes prevent recovery snapshots overwriting newer live phases and reconcile abandoned or saved rolls after process loss.
- `src/desktop/worker.ts`, `desktop/main.mts`, and `desktop/preload.cts` deliver validated typed push events through existing child-process and Electron IPC, with a narrow unsubscribe-capable renderer API.
- `desktop/app.ts` applies campaign-scoped sequenced feedback immediately, coalesces snapshot invalidations, and protects live feedback from stale snapshots. The elapsed clock is local. Initial/focus recovery and a 15-second visible-window fallback remain. Busy/stale map renders retain a short targeted retry so removing the old one-second loop does not delay map controls.
- Full Electron testing exposed concurrent settings saves racing over a shared temporary filename. Main now serializes preference saves; the new IPC UI test exercises concurrent saves.
- Existing synthetic UI fixtures now send the ordinary IPC change notification after directly writing campaign state, matching the desktop MCP path instead of depending on the old polling cadence. Documentation reflects the implemented design.

## Verification actually run

- Final `npm test`: 169 passed.
- Final `npm run test:desktop`: 6 passed (about 9 seconds), including push delivery, unsubscribe, duplicate/out-of-order and foreign-campaign filtering, late snapshot protection, campaign switch cleanup, map controls, narration, and centered dice UI.
- `npm run typecheck`: passed.
- `npm run test:journal`: passed with the existing isolated temporary daemon harness; no user daemon was stopped or reconfigured.
- Prettier check for changed runtime/tests/docs and `git diff --check`: passed.

## Limitations and next steps

No live provider/model requests were used. The Windows named-pipe branch is implemented but was not exercised on this macOS host. Cache recovery remains bounded to recent roll feedback; campaign history is authoritative and display events do not rerun gameplay. LAN clients and plugin transports remain unchanged. Restart Electron to load the IPC code. Review or commit this follow-up separately when requested.
