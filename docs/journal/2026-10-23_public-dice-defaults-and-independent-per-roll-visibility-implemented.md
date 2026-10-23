# Public dice defaults and independent per-roll visibility implemented

## Context and decision

User requested every roll default to public and require an explicit decision for a secret roll, removing inherited visibility. This supersedes the earlier diagnostic recommendation to change desktop guidance alone. Shared dice semantics intentionally apply to plugin and desktop; the popup remains Electron-only.

## Implemented changes

`src/schema.ts` RollStep and `src/referee-service.ts` administrative roll inputs now default to party. Standalone roll_dice already did. `src/review.ts` no longer compares actual visibility with the planned visibility; formula, mode, purpose, step ordering and duplicate-roll checks remain enforced. Actual rolls must explicitly request dm regardless of plan visibility. Updated tool description, desktop prompt, campaign skill, referee protocol, architecture and tool documentation. Existing persisted explicit visibility remains unchanged; no campaign data was modified.

## Verification

Final npm test: 170 passed. npm run typecheck passed. npm run test:desktop: 6 passed. TMPDIR=/private/tmp npm run test:journal: 1 passed in its isolated workspace/daemon. git diff --check passed. Regression tests exercise private-plan/public-roll, public-plan/private-roll, amended plan defaults, administrative defaults and explicitly hidden rolls. A draft regression initially failed because its purpose differed from the plan; fixed the fixture without weakening purpose validation, then reran the full suite successfully.

## Limitations and next steps

Restart the source Electron app to load rebuilt runtime and refreshed guidance. No live provider session was invoked. Existing saved rolls are not replayed or rewritten. Source changes remain uncommitted alongside the earlier IPC work; unrelated journal entries were preserved.
