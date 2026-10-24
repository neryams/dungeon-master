# Turn deadline tests use mock timers for deterministic grace and cancellation checks

## Context

The initial deadline utility tests depended on short real-time sleeps and a narrow elapsed-time upper bound. Under a loaded test runner, those values could make correct behavior look flaky.

## Decisions and rationale

- Use Node's test mock timers and explicitly advance the timeout and grace windows.
- Hold the publication lookup promise open to control whether a response exists when the lookup resolves.
- Verify the one-second bound by advancing the configured lookup timer, rather than asserting wall-clock duration.

## Completed changes

- Reworked `test/turn-deadline.test.mjs` to remove real delays and elapsed-time thresholds.
- Added deterministic checks for no-response expiry, a single grace, cancellation while checking, cancellation during grace and the bounded stuck lookup.

## Verification actually run

- `TMPDIR=/private/tmp node --test test/turn-deadline.test.mjs`: 6 passed.
- `npx prettier --check test/turn-deadline.test.mjs`: passed.

## Known limitations and next steps

- The tests use Node's built-in mock timers, supported by the repository's Node 22+ runtime requirement.
