# DM progress card moved beneath conversation above action input

## Context and decision

User requested committing IPC and public dice defaults first, then moving the DM status card to the bottom of the conversation. Committed the prior work as ba8131a. Preserved the unrelated narration disclosure journal entry outside that commit.

## Implemented

Moved active-turn markup in desktop/index.html after the transcript and above session status/action input. The detailed card replaces the generic session status while resolving in hotseat; LAN hosting information remains available. Added polite announcements for phase text only (not the ticking timer) and prevented flex shrinking of the card. The centered dice popup is unchanged.

## Verification

npm run typecheck passed; npm test passed 170 tests; npm run test:desktop passed 6 tests. Visually inspected the Electron screenshot at /tmp/dm-dice-feedback-ui.png and confirmed the card sits above the bottom composer. git diff --check passed. No campaign data or running user session was changed.

## Next steps

Layout changes remain uncommitted for review. Restart Electron to load the rebuilt UI. No additional journal integration test was needed for this presentation-only change.
