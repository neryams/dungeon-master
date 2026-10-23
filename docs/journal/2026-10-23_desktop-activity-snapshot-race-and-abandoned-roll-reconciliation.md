# Desktop activity snapshot race and abandoned roll reconciliation

## Context

Follow-up review of the event-driven desktop activity work found that a snapshot could read campaign state, wait on recovery-file I/O, then overwrite a newer live socket phase with the older file phase. A public rolling entry could also remain unresolved if its MCP process died after saving a roll event but before sending its final notice.

## Implemented changes

`src/desktop/host.ts` captures the activity sequence before snapshot I/O and skips file reconciliation if any newer desktop event arrived during the reads. Recovery merges file rolls only against the matching sequence. When the host is ready or needs attention after a turn, the snapshot reconciles rolls against authoritative party-visible committed events: matching events produce their saved total/dice, while unresolved rolling entries become failed. During resolving, independently reported concurrent rolls remain rolling even when absent from a partial recovery file. A failed roll is not revived by a stale rolling file entry in a later turn; a new live notification can still represent a retry.

`test/hotseat.test.mjs` now forces a delayed recovery read while a newer phase arrives, and covers process loss after commit, an abandoned roll, concurrent pending entries, and stale-file behavior in a later resolving stage.

## Verification

`npm run typecheck` passed. `node --test test/hotseat.test.mjs` passed (10 tests), then focused race/reconciliation tests passed (2 tests) after the final merge safeguard. `git diff --check` passed. The coordinating task owns the full suite. No campaign data outside test fixtures or shared journal daemon was touched.

## Next steps

Integrate with Electron/UI checks and complete the full required test suite before review.