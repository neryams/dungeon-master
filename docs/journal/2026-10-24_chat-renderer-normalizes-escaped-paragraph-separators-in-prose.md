# Chat renderer normalizes escaped paragraph separators in prose

## Context and implementation
A user screenshot showed literal backslash-n pairs in saved chat narration. The shared desktop/LAN Markdown renderer previously passed these through as prose. `desktop/markdown.ts` now converts repeated escaped newline separators (including escaped CRLF) before rendering. Markdown's own block maps protect fenced, indented and incomplete fenced code; inline code spans and single backslashes remain literal. Existing actual newlines and HTML escaping retain their behavior. Saved campaign events are unchanged.

## Verification
Added `test/markdown.test.mjs` to exercise paragraph boundaries, headings, bold text, code escapes, paths and inert HTML through the actual shared renderer. Targeted test and npm run typecheck pass. Isolated TMPDIR=/private/tmp npm run test:journal passes. Full TMPDIR=/private/tmp npm test passed all 198 tests; build output has been refreshed. git diff --check passed.

## Scope
Display-only repair for repeated escaped paragraph separators. No general JSON decoding or campaign history migration. Applies to both desktop and LAN chat displays. Speech text normalization is unchanged. Intended as a follow-up to PR #7.