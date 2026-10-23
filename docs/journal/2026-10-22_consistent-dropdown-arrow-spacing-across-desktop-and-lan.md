# Consistent dropdown arrow spacing across desktop and LAN

## Context and decision

The user asked to make the provider arrow-spacing correction universal because the rules edition selector also touched its border. Applied the same presentation rule to every select in each of the application's two existing stylesheets.

## Completed changes

- desktop/theme.css: promoted the provider-only chevron styling to the generic select rule, covering provider, rules edition, map selection, map viewport and LAN invitation selection. Kept the provider's width constraint. Updated map-specific padding and background-color overrides so they preserve the chevron and its reserved space.
- desktop/lan.css: applied the same 12px right inset and 36px reserved padding to LAN map, viewport and character selectors, using the LAN theme's text color.
- Rebuilt and refreshed the open setup window. Inspected generated setup and 1000x720 gameplay screenshots: edition, map and viewport arrows now have a clear border inset.

## Verification actually run

- TMPDIR=/private/tmp npm run test:desktop passed.
- TMPDIR=/private/tmp DM_CHROME=<installed macOS Chrome executable> npm run test:lan passed its phone/desktop browser scenarios.
- npm run typecheck passed.
- git diff --check passed.

## Limitations and next steps

Styling only; native dropdown semantics and provider/campaign behavior remain unchanged. No new tests or provider inference calls. Full 108-test suite last passed during the original overflow correction; this follow-up used the relevant desktop/LAN UI checks. Changes and related journal notes remain uncommitted for review.
