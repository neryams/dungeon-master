# Private desktop turn performance logging implemented and verified

## Context and decisions
User requested performance logging committed separately before turn-pacing and referee-model optimizations. Builds on the prior latency investigation. No campaign content or private player data is included here.

## Implemented changes
Added src/desktop/performance.ts: allowlisted timing JSONL under campaign-local ignored .dm/hotseat, separate performance.jsonl and performance-backend.jsonl, each limited to 1 MiB plus one backup. Files use mode 0600, symlink-safe paths, serialized capped queues and cross-process nonwaiting rotation locks. Logging errors and callback errors do not change game outcomes; records may be dropped under contention/overflow.

DesktopHost correlates request start/completion/interruption and provider dispatch/tool boundaries with request IDs, provider and explicit model selection. Owner metadata carries active request correlation without extra campaign replay per diagnostic. Desktop MCP wrapper records full backend execution duration, failures, and first successful publication; custom artwork import is included. No prompts, prose, raw arguments/results or stderr are saved. Gameplay events, retries, review validation and LocalMemoryGuard remain unchanged.

Docs updated in docs/desktop.md and docs/architecture.md. Tests cover privacy/permissions, rotation and concurrent appends, symlink refusal, failure isolation, actual backend transport/publication, host lifecycle and provider timing correlation/throwing callbacks.

## Verification actually run
npm test: 174 passing. npm run typecheck: passed. npm run test:journal: 1 passing in its isolated temporary workspace/daemon. Used TMPDIR=/private/tmp for canonical macOS temporary paths; an initial subagent Codex artwork test with the environment's /var alias failed symlink validation, while the complete suite with canonical temporary paths passed. git diff --check passed. No live provider inference or actual campaigns were used or changed; no daemon stopped or reconfigured.

## Limitations and next steps
Provider timings cannot distinguish inference, network, scheduling or referee waits internally. CLI-default model identity may be unknown; tool duration requires matching provider event IDs. Best-effort logs may omit records on shutdown, contention or queue overflow; they are not authoritative history. First-publication deduplication is process-local and analysis can select the earliest marker per request. Next: commit this logging milestone, then reduce redundant agent reads and allow main-DM selection of a fast/cost-effective supported referee model while retaining review guards. Those optimizations are not implemented in this milestone.
