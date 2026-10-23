# PR 6 duplicate CI failures reveal mixed-age desktop snapshots

## Context

After commit `5ccd50c`, the push workflow run 40016890266 and pull_request workflow run 40016898094 both failed at `test/hotseat-setup.test.mjs:165`. These are two executions of the same suite on the same commit, not two distinct failing tests. Both passed 169/170 cases. The failing setup test now reaches ready but its returned follow-up turn is pending instead of completed.

## Investigation and decision

The prior timeout-focused diagnosis was incomplete. Current code demonstrates a real mixed-age snapshot race: `src/desktop/host.ts` snapshot reads saved state at line 710, awaits activity recovery at 714, then returns the current mutable stage/detail at 762-763 alongside the earlier state. Meanwhile resolveTurn commits completed at 676-679 and then sets ready at 680. A snapshot can therefore return stage ready with an older pending transcript. Independent subagent review confirmed this interleaving. Increasing the test deadline does not address it, and waiting for both conditions would hide an inconsistent public host response.

## Completed work and verification

Read both failed GitHub Actions logs and verified their event types and identical head commit. Inspected snapshot and resolveTurn ordering and failing assertion. No source changes or new test runs in this diagnostic turn. The exact race was established by code inspection and CI's matching mixed-state observation; no deterministic reproduction added yet.

## Proposed next steps

Capture lifecycle stage/detail at snapshot entry alongside sequence and use those values consistently, or retry snapshots across lifecycle changes. Add a gated-read regression test that forces completion between state capture and snapshot return. Then run npm test, npm run typecheck and isolated npm run test:journal. No commit or push performed in this turn. This entry supersedes the earlier timing-only hypothesis.
