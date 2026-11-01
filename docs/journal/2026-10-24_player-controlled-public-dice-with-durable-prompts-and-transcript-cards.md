# Player-controlled public dice with durable prompts and transcript cards

## Context and decisions

User requested that public rolls for player characters wait for human input in hotseat and on the LAN client claiming that character. Explicit clarification: physical entries are always raw die faces BEFORE modifiers. Public DM/monster rolls remain automatic; hidden rolls remain hidden. Implemented per-face fields for multiple dice and two faces for advantage/disadvantage, preserving ordinary roll modes and calculating modifiers in the existing dice function.

## Completed changes

- `src/schema.ts`, `src/domain.ts`, `src/review.ts`: optional event-backed pending requests and completion references, raw-face/result validation, cancellation when associated reviewed actions or party eligibility change, and exclusion of pending coordination metadata from partyState and gameplay fingerprints. Legacy undefined rosters retain visible-character fallback; explicit empty rosters remain empty.
- `src/desktop/player-roll.ts`: typed request/submission orchestration, reviewed and administrative fallback support, exact retry identity checks, private-purpose sanitization, and persistent public result projection from events. Requests are saved without generating dice; completion transacts once. Existing events are not rewritten.
- `src/desktop/server.ts`: public PC roll tools wait without holding campaign locks; automatic/private rolls retain ordinary behavior. No rolling animation begins while awaiting player input. `src/desktop/host.ts`, `lan.ts`, `contracts.ts` expose prompts/results and authorize seat-bound LAN submissions. Desktop guidance requires the actual rolling character ID, including saving throws.
- `src/desktop/turn-deadline.ts`, provider adapters: defer turn expiration for a matching active request awaiting player dice; bounded lookup and cancellation behavior remain. Codex tool timeout is extended for physical-table input.
- `desktop/app.ts`, `lan.ts`, HTML/CSS and `roll-cards.ts`: hotseat/LAN prompts, bounded numeric inputs, preserved input/retry state, recovery-stage submission, and cards interleaved with narration by revision. Input remains usable while the DM is resolving. Desktop status explicitly indicates waiting for player dice.
- Updated README and desktop/tool/architecture documentation. No commit, push, or changes to actual campaign data.

## Verification actually run

- Final `TMPDIR=/private/tmp npm test`: 209 passed.
- `npm run typecheck`: passed.
- Desktop suite (`node --test` with the same seven files as `npm run test:desktop`): 7 passed, including a real Electron/host pending-roll fixture that validates raw physical faces, limits, persistent cards and digital rolls.
- `TMPDIR=/private/tmp DM_CHROME='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' npm run test:lan`: 1 passed.
- `TMPDIR=/private/tmp npm run test:journal`: 1 passed using its isolated temporary daemon/workspace. Existing journal daemon untouched.
- Added backend tests for raw faces/modifiers, advantage/disadvantage, multidice, privacy, idempotency, administrative fallback and legacy roster behavior; actual MCP wait/submit/retry and authenticated LAN seat tests.
- Inspected a rendered Electron prompt screenshot and ran `git diff --check`.
- Earlier default-temp run hit the existing macOS symlink rejection in artwork tests; direct `/private/tmp` resolved it. One intermediate full run stalled in the existing setup race test; its owned test child was terminated, isolated setup tests and final full rerun passed. A draft UI mock test was replaced with a real host fixture because Electron bridge methods are immutable.

## Limitations and next steps

No live Codex/Antigravity/Ollama gameplay session was invoked. Pending dice and results survive restart, but an interrupted provider turn still requires explicit reconnect/recovery; submitting dice does not replay the interrupted action. The ordinary plugin and read-only panel keep their existing entry interfaces. Restart the source desktop app to load the changes. Source and this journal entry remain uncommitted for review.
