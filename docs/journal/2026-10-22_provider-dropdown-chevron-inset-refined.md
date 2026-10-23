# Provider dropdown chevron inset refined

## Context and decision

The user reported that the provider dropdown arrow was too close to the right border after the overflow correction. The native macOS select indicator ignored the intended visual inset. Kept the semantic native select and supplied a decorative CSS chevron with controlled positioning.

## Completed change

Updated desktop/theme.css only: suppress native select appearance for the provider control, add a small inline SVG background chevron positioned 12px from the right, and reserve 36px of right padding so longer labels do not overlap it. The earlier flex shrink and width correction remains intact. Rebuilt and refreshed the user's open setup window; visually confirmed the new spacing on macOS.

## Verification actually run

- TMPDIR=/private/tmp npm run test:desktop passed the existing real Electron UI smoke, including provider selection.
- npm run typecheck passed.
- git diff --check passed.
- Inspected the refreshed application screenshot and confirmed the arrow is inset from the border.

## Limitations and next steps

This follow-up changes presentation only. The full 108-test suite passed during the preceding overflow fix; it was not rerun for this arrow-only styling adjustment. No provider inference, campaign changes, commit, or push occurred. All UI changes remain uncommitted for review.
