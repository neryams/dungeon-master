# Filter mechanical annotations from speech while preserving narrative asides

## Context and decisions

The user authorized committing the completed Gemini migration and requested smoother narration without coordinate notation. The migration was committed as `a1b0617` (`Replace Phonon with optional Gemini desktop speech`). The speech filter uses a conservative, deterministic allowlist instead of deleting all parenthetical content or making another model request. Narrative asides and mixed prose/mechanical annotations remain audible rather than risking loss of story information.

## Completed changes

- `src/desktop/speech-text.ts` now removes complete parenthesized or square-bracketed numeric coordinate pairs/triples, optionally labeled coordinates/coords/grid, and explicit x/y/z assignments. Signed and decimal coordinates are supported.
- Standalone dice formulas/results and DC, AC and HP annotations (including comma/semicolon-separated groups) are omitted too. Filtering happens after Markdown extraction and before bounded chunking, so bold/inline-code formatting does not bypass it. Whitespace before punctuation is cleaned up.
- Narrative parentheses, meaningful prose with numbers, and mixed annotations are retained. Existing code-block/link-destination exclusions remain in place. No transcript, event, campaign state or displayed message is modified.
- Added speech-text cases and extended the DesktopHost integration test to verify filtered text with preserved narrative parentheses and unchanged saved events.

## Verification actually run

- `npm run typecheck`: passed.
- `TMPDIR=/private/tmp npm test -- --test-concurrency=4`: 231/231 passed, including the new filter cases and host integration assertion.
- Prettier ran on the three changed code/test files.

## Limitations and next steps

The filter intentionally recognizes specific annotation formats; ambiguous prose is preserved. No live Google call is needed for this deterministic preprocessing change and none was made. The earlier packaged release has not been rebuilt for this follow-up; development builds include the change and the next release build will incorporate it. No push was requested or performed. The user authorized a separate commit for the enhancement as part of this task.
