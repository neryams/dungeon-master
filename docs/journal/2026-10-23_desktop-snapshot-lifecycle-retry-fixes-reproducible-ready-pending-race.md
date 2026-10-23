# Desktop snapshot lifecycle retry fixes reproducible ready pending race

## Context and decisions

Continued PR #6 from `5ccd50c` after both push and pull_request CI checks reported a ready snapshot containing a pending follow-up turn. The user authorized implementing a fix, committing/pushing to the existing branch and testing through GitHub Actions.

The timeout adjustment alone was insufficient. `DesktopHost.snapshot` read authoritative state, awaited activity recovery and then returned the latest mutable stage/detail alongside older state. Capture-only lifecycle fields could introduce the converse race when a submission starts during a read, so the implemented fix retries if stage/detail changed across either awaited read.

## Completed changes

- `src/desktop/host.ts`: capture lifecycle stage/detail at entry, retry on lifecycle changes during state or activity reads, return the captured lifecycle fields and use captured stage in roll reconciliation.
- `test/hotseat-setup.test.mjs`: force completion between a snapshot's pending-state read and return using a read gate plus a real host ready event. The gate claims the host's first read before awaiting I/O, excludes the service fixture's store, and has a 10-second test timeout. Existing no-replay and completed-opening assertions remain intact.
- `docs/architecture.md`: document lifecycle-change snapshot retries.
- Independent lower-cost subagent implemented/reviewed the regression and confirmed the retry handles both directions of the lifecycle race.

## Verification actually run

- Regression against the old compiled host: failed with `a ready snapshot must include the completed turn`; other three setup tests passed.
- Targeted setup tests with fix: 4 passed.
- Final `TMPDIR=/private/tmp npm test`: 170 passed.
- `npm run typecheck`: passed.
- `TMPDIR=/private/tmp npm run test:journal`: passed using its isolated temporary workspace/private daemon; no shared daemon was stopped or reconfigured.
- `TMPDIR=/private/tmp npm run test:desktop`: 6 passed.
- `npm run package:plugin`: passed.
- Prettier checks for changed source/test/architecture and `git diff --check`: passed.

## Limitations and next steps

No gameplay event changes or live model/provider requests. Commit these changes with the preceding diagnosis entry, push `codex/desktop-dice-feedback`, and inspect both GitHub Actions checks for the pushed commit; remote verification is pending at the time of this entry. Preserve the unrelated untracked narration-disclosure note.
