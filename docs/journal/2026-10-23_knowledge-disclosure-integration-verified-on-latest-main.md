# Knowledge disclosure integration verified on latest main

## Context and decision

Implemented the requested DM narration and knowledge improvements on `codex/dm-knowledge-disclosure`, created from freshly fetched `origin/main` at `85617ce`. Latest-main public dice defaults and desktop reveal behavior are preserved. Existing investigation notes were retained. No campaign data was modified; synthetic tests only.

## Completed changes

`src/schema.ts`, `src/domain.ts`, `src/review.ts`, `src/service.ts` and `src/server.ts` add optional event-backed knowledge facts, typed set_knowledge changes, validated entity/recipient references, nonempty truth/disclosure evidence, a DM-only exact read tool and resume context. Facts distinguish established truth, claims and plans, optional observable descriptions, holders, nonbinding discovery hints and recipient-specific disclosures. Party projection omits the entire ledger. Knowledge changes remain story operations but invalidate pending action fingerprints. Existing histories and backup restoration retain compatibility.

Review added `knowledgeOffset`/`nextKnowledgeOffset` paging to make facts beyond the first 100 readable without guessing opaque IDs. `test/knowledge.test.mjs` verifies replay, retry, export/import, visibility, partial and attributed disclosures, invalid evidence, reference validation, legacy state, paging and stale review behavior; MCP tests cover new tool registration and party denial.

Run/create/close/referee skills and `src/desktop/narration-guidance.ts` reinforce perception before conclusions, attributed testimony, earned discovery, open player choices, fair risk warnings, respectful humor, and separation of internal mechanics from fiction. The shared desktop host prompt explains that clue-connecting, theories and earned surprises are part of the fun. Review explicitly retained main's normal-table public-roll guarantee. README, architecture and tool documentation describe the contract and limits.

## Verification actually run

- First npm test run: 173/174 passed; existing artwork-import test rejected a macOS symlink in the temporary directory path.
- Re-ran full suite with canonical temporary directory: `TMPDIR=/private/tmp npm test`, 175/175 passed after final functional changes and expanded coverage.
- `npm run typecheck` passed.
- `TMPDIR=/private/tmp npm run test:journal` passed using its isolated daemon/workspace; no existing journal daemon was stopped or reconfigured.
- `npm run package:plugin` passed.
- Prettier check of changed source, tests, skills and docs passed; `git diff --check` passed.

## Limitations and next steps

Narration quality is guided, not semantically enforced. No live model playthrough was run; use a synthetic mystery playtest to assess whether the DM consistently avoids omniscient labels and solution menus. Existing campaigns are not automatically backfilled with knowledge facts, and already published spoilers are not rewritten. All work remains uncommitted and unpushed for review.
