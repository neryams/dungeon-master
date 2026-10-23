# Dice feedback retry and late-result handling

## Context and decisions
Follow-up to `docs/journal/2026-10-23_electron-saved-dice-result-feedback.md`. Review found that an action may stop before the saved roll update arrives, and retries may reuse the same roll ID. The feedback controller now keeps unresolved IDs long enough to show a later committed total once, including after the unavailable card auto-closes. A failed-to-rolling transition reuses the active card or queues a retry without creating a duplicate result. Manually dismissed IDs remain suppressed.

## Completed changes
- Continued the number animation while a roll remains unresolved and derives the flicker range from the notation's die size.
- Removed unnecessary DTO casts from `desktop/app.ts`.
- Updated the Electron UI harness to use the actual styled feedback panel and `showCampaign` activity baseline; it checks the active-turn phase and elapsed card.
- Added coverage for late totals while visible and after auto-close, failure-to-completion, failed-to-rolling retry, dismissal, reduced motion and cleanup.

## Verification
- `npm run test:desktop` passed, including all five Electron UI tests.
- Screenshot for visual inspection: `/tmp/dm-dice-feedback-ui.png`.

## Known limitations
The animation remains decorative; all displayed outcomes come from the snapshot's saved roll fields.

## Next steps
Parent task owns broader repository checks and final review.