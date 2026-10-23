# Electron IPC progress event UI integration tests

## Context
The desktop activity feed now delivers typed activity and saved-state change events to the renderer over Electron IPC. The test needs to prove prompt feedback and campaign-scoped cleanup without invoking a live CLI or model.

## Decisions and rationale
- Exercise the actual Electron preload subscription and renderer markup, injecting valid events through the Electron main process.
- Use two temporary campaign fixtures and the existing Electron harness so all campaign state remains outside the source repository.
- Cover listener unsubscribe, event identity and sequence guards, authoritative roll presentation, snapshot refresh on a changed event, and campaign switching.
- Include a delayed assertion that an older host snapshot does not erase newer pushed activity.

## Completed changes
- Added `test/desktop-events-ui.mjs` with coverage for callback payload shape, unsubscribe, rolling and completed totals, wrong root/campaign, duplicate/out-of-order sequence rejection, changed-event snapshot reload, stale snapshot protection, and switching campaign roots.
- Added the test to `npm run test:desktop` in `package.json`.

## Verification
- `node --test test/desktop-events-ui.mjs` passed (1 test).
- A mistaken filtered `npm run test:desktop` invocation appended the filter after the script's test file list and started the full suite; I stopped it after discovering that. The event test exposed an assertion race between the animated total and breakdown; it now waits for the breakdown text before asserting. The rerun of the focused file passed.
- No live CLI, model, or journal daemon was used by this UI test.

## Known limitations
- This test injects IPC events from Electron main as specified; worker-to-main event transport is covered by the backend/worker tests.
- Full-suite results are being handled by the parent task.

## Next steps
- Keep this test in the desktop UI suite and run the repository's required verification after the remaining runtime changes settle.
