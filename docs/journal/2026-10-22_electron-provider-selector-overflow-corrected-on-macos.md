# Electron provider selector overflow corrected on macOS

## Context and decision

The user supplied a screenshot showing the DM provider selector extending past its card and into the adjacent campaign form. Current base is main at 0fe3bf9. The native select sizes to its longest option, while its flex-item wrapper retained the default automatic minimum width. Constraining only the select's existing max-width did not constrain that wrapper.

## Completed changes

In desktop/theme.css, let the provider details flex item grow within the card and shrink below its intrinsic content width using flex: 1 and min-width: 0. Set the select to the available width and use an ellipsis for longer selected labels. Kept the native dropdown and full option labels.

Rebuilt the application and refreshed the user's open setup window. Visually confirmed that the selected control, dropdown arrow, and detection status fit inside the provider card. Inspected Electron smoke screenshots for Codex and the longer experimental local provider option; both fit their card.

## Verification actually run

- TMPDIR=/private/tmp npm run test:desktop: passed the existing real Electron UI smoke, including normal and compact gameplay layouts.
- npm run typecheck: passed.
- TMPDIR=/private/tmp npm test: all 108 tests passed.
- git diff --check: passed.

## Limitations and next steps

This change is CSS only. No campaign, journal integration behavior, provider inference, or authentication changes were made. No new tests were added for this small visual correction; existing Electron coverage and screenshot inspection verified the result. The source change and this journal entry remain uncommitted for review.
