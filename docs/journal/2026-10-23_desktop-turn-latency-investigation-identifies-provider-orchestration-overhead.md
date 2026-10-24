# Desktop turn latency investigation identifies provider orchestration overhead

## Context and evidence
Read-only investigation of locally available Antigravity CLI logs, conversation timing metadata, and authoritative event timestamps. No campaign prose, identities, paths, request IDs, or private player data are included here. Current source Git status was clean before investigation. README.md and docs/architecture.md were read.

## Findings
Two completed gameplay turns measured approximately 213 and 498 seconds from submission to publication. The corresponding main-trajectory generation-step intervals totaled approximately 114 and 388 seconds (13 and 18 steps). Union of main-trajectory tool intervals totaled approximately 18 and 23 seconds; this includes provider overhead, not just backend execution. Remaining wall time includes referee handoff/wait intervals. Timings were reconstructed from provider SQLite metadata with read-only access; provider internal field semantics are not a stable application contract. Generation intervals include provider latency and cannot isolate inference from queue/network time.

In the longer sample, approval-to-commit included a roughly 73-second generation step. Commit-to-publication took roughly 123 seconds and included state/map reads, two no-op tool attempts, narrative updates, and further generation. This is evidence that pre-publication workflow can be shortened without assuming storage is the bottleneck. Provider log checks generally added about 1–2 seconds per evaluated tool, not minutes. Do not remove review protections solely on this sample.

## Current instrumentation and decisions
src/server.ts already logs tool duration/status to stderr around service.execute, covering desktop service wrappers and journal work. src/desktop/antigravity.ts discards CLI stderr and tracks tool completion without persistent request-correlated timings. src/desktop/host.ts has no full-turn timing summary. No behavior or logging implementation changed during this investigation.

## Proposed next steps
Add bounded private structured timing logs outside campaign events: request/provider/model, dispatch, tool start/end/name/status, first publication, completion, and available delegation/generation boundaries. Preserve backend duration separately from provider-observed duration. Do not log prompts, arguments, results or raw stderr. Follow up on redundant state verification, no-op attempts and narrative bookkeeping before publication; existing host guidance already permits bookkeeping afterward. Instrument journal subphases only if actual backend durations justify it.

## Verification and limitations
Read-only timeline reconstruction and source review completed; no model calls or benchmark gameplay performed. No daemon was stopped/reconfigured and no campaign files were modified. npm suites were not run because no behavior changed. Small sample; no causal benchmark or general claim across providers/models. No commit or push performed.
