# Speech text eligibility and Markdown chunking utilities

## Context and decisions

The desktop narration integration needs a deterministic way to select public table publication revisions and turn Markdown narration into bounded speech text. Eligibility is derived from the authoritative event stream, with legacy mode as the default; `review.configure` updates the active mode and publications in setup mode are excluded. Markdown parsing uses the already installed `markdown-it` dependency. Headings, paragraphs and individual list items remain separate speech parts to retain pauses. Code blocks and raw HTML blocks are skipped; inline code reads naturally, image alt text is retained, and links do not read their destinations.

## Completed changes

Added `src/desktop/speech-text.ts` with `speechEligibleRevisions` and `speechParts`. Added `test/speech-text.test.mjs` covering legacy/setup/reviewed transitions, event immutability, mixed Markdown and entities, excluded destinations/code, structural pauses, sentence chunking, long unbroken text and empty output.

## Verification actually run

- `node --test test/speech-text.test.mjs`: 3 passed.
- `npx prettier --write src/desktop/speech-text.ts test/speech-text.test.mjs`: completed.
- `npm run typecheck` and a direct core TypeScript compilation report errors in concurrently edited `src/desktop/speech-runtime.ts` (unused `MODEL_REVISION`, stderr stream nullability); no diagnostics were reported for the new utility.

## Limitations and next steps

No full test suite or journal integration test was run in this delegated two-file scope. Re-run full typecheck and required repository checks after the concurrent speech runtime changes are repaired.