# Prominent campaign setup generation activity indicator

## Context and decision

The user reported that long campaign generation looked inactive because the existing resolving message was too small. Added a prominent activity card specifically for resolving turns in event-backed campaign setup. Ordinary gameplay retains the existing compact status.

## Completed changes

- desktop/index.html adds an accessible live status card with a decorative large spinner, a clear heading, progress detail and an explanation that generation can take a few minutes.
- desktop/app.ts shows the card only for reviewMode setup with stage resolving. Descriptive text is based on actual saved party, map and opening state, with no invented percentages or timed progress. The card hides when a turn finishes, fails, disconnects or leaves setup.
- desktop/theme.css provides a 48px gold spinner and highlighted card matching the creation screen, with animation disabled for reduced-motion preferences.
- Expanded test/desktop-ui.mjs to present synthetic host stages without provider calls, verify visibility during setup work and hiding on attention/ordinary play, check descriptive text after saved progress, verify reduced motion and ensure the composer remains within the minimum-size window. Inspected the generated campaign-generating.png screenshot.
- Documented the behavior in docs/desktop.md. No campaign state, provider protocol, tool lifecycle or direct model API changes.

## Verification actually run

- TMPDIR=/private/tmp npm run test:desktop passed with the expanded UI coverage.
- TMPDIR=/private/tmp npm test passed all 112 tests.
- npm run typecheck passed.
- Prettier checks for the changed UI files and git diff --check passed.

## Limitations and next steps

The message describes saved progress and expected remaining setup work; it does not expose private agent reasoning or claim a precise internal tool phase. Existing app sessions load the new frontend on their next launch; the current session was left running. This follow-up remains uncommitted with the preceding campaign creation changes on codex/electron-campaign-setup. No live model run was needed for this presentation change.
