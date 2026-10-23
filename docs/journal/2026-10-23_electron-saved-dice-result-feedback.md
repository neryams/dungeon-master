# Electron saved dice result feedback

## Context and decisions
The desktop renderer now receives event-backed dice activity through the campaign snapshot. The feedback panel is presentation only: its brief number animation is decorative, while the final total and breakdown come only from the saved activity DTO. Opening a campaign seeds the observed roll IDs as a baseline so historical activity does not replay. Queued rolls are shown one at a time, and a dismissed batch stays dismissed while later new rolls can still appear.

Reported physical rolls skip animation; advantage and disadvantage show the selected roll set without summing both dice. Reduced-motion preference also skips number flicker. The active turn indicator shows the provider's actual activity phase when present, otherwise “The DM is thinking,” with elapsed resolving time. The UI is Electron-only.

## Completed changes
- Added `desktop/dice-feedback.ts` and wired it to the activity snapshot in `desktop/app.ts`.
- Added accessible feedback markup and olive/brass styling in `desktop/index.html` and `desktop/theme.css`; random frames are hidden from assistive technology and only final results are announced.
- Added the module to `tsconfig.ui.json` and the targeted Electron test to `test:desktop`.
- Added `test/dice-feedback-ui.mjs` covering baseline suppression, saved totals, queued results, reduced motion, reported-roll presentation, dismissal and timer cleanup.

## Verification
- `npm run build` passed.
- `node --test test/dice-feedback-ui.mjs` passed (1 test).

## Known limitations
The roll panel displays only while its current or queued batch is active, then closes automatically. No campaign records or events are changed.

## Next steps
Run the full desktop UI suite and broader repository checks as part of the parent task.