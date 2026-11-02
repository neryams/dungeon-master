# Prepare Gemini speech pull request with current Windows packaging preserved

## Context and decisions

The user explicitly authorized committing all remaining work, pushing it, and opening a pull request. The old `dice-ux` pull request was already merged, so created `codex/gemini-speech`. Committed the retry/prefetch implementation and log-verification journals as `5c58e32`, retaining earlier speech commits `a1b0617`, `14cc594`, and `3574dc5`.

Fetched `origin/main` at `b8af6ed`, which includes Windows compatibility and packaging work absent from this branch. Merged that history and resolved overlapping speech/packaging changes rather than removing the Windows work. Kept main's Windows-aware bundled Node selection, Windows x64 hashes/extraction, npm.cmd/builder handling, artwork/import/setup fixes, and platform-aware tests. Kept the Gemini migration's removal of Phonon environment/license branches, runtime test, assets, installers, and license packaging. `scripts/smoke-packaged-desktop.mjs` now retains both platform layouts while asserting the absence of obsolete speech tooling and credentials.

## Verification actually run after integration

- `npm run typecheck`: passed.
- `TMPDIR=/private/tmp npm test -- --test-concurrency=4`: 254 passed.
- Seven desktop UI tests listed by `test:desktop`, executed with `TMPDIR=/private/tmp`: all passed.
- LAN browser test with the installed macOS Chrome path supplied via `DM_CHROME`: passed. The initial run used the test's Linux default executable path and failed to launch; the explicit macOS path resolved that environment issue.
- `TMPDIR=/private/tmp npm run test:journal`: passed with its isolated temporary daemon/workspace; no existing daemon changed.
- `npm run package:plugin`: passed.
- Three desktop packaging contract tests and changed merge-file formatting/diff checks: passed.
- `TMPDIR=/private/tmp npm run desktop:dist`: passed after final merge resolution.
- `TMPDIR=/private/tmp npm run desktop:smoke -- --launch`: passed. Refreshed unsigned macOS arm64 app, DMG, and ZIP in ignored `release/`.

## Limitations and next steps

Native Windows execution was not available on this macOS host; platform-specific packaging configuration and existing Windows fixes were preserved. No real Google requests were made for PR preparation. Release binaries remain ignored local build artifacts, not source commits. Complete the merge commit, push `codex/gemini-speech`, and open the authorized pull request against `main` with these verification results. No merge of the pull request itself is requested.