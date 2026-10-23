# CI setup follow-up wait uses a bounded deadline and reports host errors

## Context and diagnosis

Investigated PR #6 Actions run 40015050150, job 120624855440, at branch HEAD `0df23ac`. CI passed 169/170 tests; `test/hotseat-setup.test.mjs` timed out at the final ready-state wait for the interrupted-setup follow-up. The old helper polled 200 times with 5 ms pauses, a nominal one-second budget plus snapshot I/O. The asynchronous follow-up performs several campaign transactions and a PNG render while the suite competes for resources. `DesktopHost.resolveTurn` converts errors to attention state, but the old helper hid that detail behind a timeout.

The exact CI failure did not reproduce locally or in a Linux Node 22 Docker container capped at two CPUs, including a full-suite run before the deadline change. Timing sensitivity is the likely explanation, not a proven runtime defect. Independent lower-cost subagent inspection found no Linux-specific map/host deadlock and confirmed the diagnostic weakness.

## Completed changes and rationale

Updated only `test/hotseat-setup.test.mjs`: use a monotonic 10-second deadline, poll every 25 ms to reduce snapshot load, fail immediately with the host detail on unexpected attention state, and include last stage/detail on timeout. Expected attention waits return before that assertion. Assertions about no replay and completed setup remain intact. No gameplay or host behavior changed.

## Verification actually run

- Final `TMPDIR=/private/tmp npm test`: 170 passed.
- Final `npm run typecheck`: passed.
- Final `TMPDIR=/private/tmp npm run test:journal`: 1 passed, using the harness's isolated temporary workspace and private daemon; no shared daemon was stopped or reconfigured.
- Final full `npm test` in Node 22 Bookworm Linux Docker container capped at two CPUs: 170 passed.
- Prettier check for the changed test and `git diff --check`: passed.

An initial macOS full-suite run without the TMPDIR override failed the separate Codex artwork import fixture because its generated path traversed a symlink. Canonical `/private/tmp` passed without modifying that unrelated test or weakening path checks. Linux verification passed without an override.

## Limitations and next steps

The original transient CI failure was not reproduced. Review the test-only patch and rerun GitHub CI after committing/pushing when authorized. No commit or push performed. The preexisting untracked narration-disclosure journal note remains unrelated.
