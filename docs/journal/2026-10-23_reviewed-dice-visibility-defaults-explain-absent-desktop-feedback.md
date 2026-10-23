# Reviewed dice visibility defaults explain absent desktop feedback

## Context and findings

Read-only investigation of a reported missing desktop dice popup found a mismatch in visibility defaults. `src/service.ts` defaults standalone roll_dice visibility to party, but reviewed roll plans in `src/schema.ts` and referee amendment input in `src/referee-service.ts` default to dm. The run-campaign skill requires actual rolls to match the recorded plan visibility. Desktop activity in `src/desktop/activity.ts` deliberately excludes dm-visible rolls, including pending animations.

## Decision and rationale

A missing popup for a private roll is expected behavior and is not evidence of campaign age incompatibility or IPC failure. Do not indiscriminately expose DM rolls or rewrite authoritative history. Desktop guidance should explicitly distinguish ordinary player-facing checks (party visibility at the ruling stage) from genuinely hidden checks (dm visibility). Changing shared schema defaults would also affect plugin behavior and needs separate consideration.

## Verification actually performed

Inspected persisted roll and ruling visibility metadata and the disposable activity feed read-only, then traced current source defaults and filtering. No campaign files or running processes were modified. No source behavior changes or tests were made during this diagnostic investigation. Private campaign contents are intentionally omitted from this engineering record.

## Limitations and next steps

Saved events establish final visibility but cannot establish whether the provider explicitly selected dm or omitted visibility and received its default. The investigation does not prove end-to-end IPC health. Add explicit desktop referee-stage visibility guidance and coverage for reviewed public rolls if implementing a follow-up fix; preserve private-roll filtering and plugin behavior.
