# Live timeout traced to absolute deadline after successful publication

## Context
User reported a DM timeout after the performance instrumentation and pacing changes. Read-only investigation of the latest local diagnostic logs, provider trace metadata and authoritative event types/timestamps. No campaign prose, identities, paths or private player details are included here. Existing uncommitted pacing/model-selection changes were preserved.

## Findings
The host interrupted the turn at 600.457 seconds, matching the adapters' default absolute 600000-ms timer. Provider trace showed SIGTERM at the deadline rather than a provider outage preceding it. All 16 observed backend tool calls succeeded, totaling 2752 ms, with a maximum of 298 ms. Saved mechanics committed at roughly 528 seconds, public narration at 546 seconds, and subsequent narrative updates at 594 seconds. The durable request was then marked interrupted at 600 seconds. The public response and committed state survived.

The main provider trajectory contained 25 generation/response steps totaling approximately 559 seconds; these provider-internal timings are not pure inference measurements and can overlap other activity. It performed serial rules retrieval for over two minutes after preparing the action and before invoking the referee. The referee invocation explicitly selected Model=inherit despite updated speed/cost guidance being present in the generated workspace; this does not prove a suitable cheaper override was advertised. Rule-review messages themselves were returned much faster than the whole turn. No evidence of a sustained backend or network failure in the turn window; startup auth warnings preceded successful connection and gameplay, and final telemetry cancellation followed termination.

## Proposed fixes (not implemented)
1. Make timeout handling aware of authoritative publication: distinguish a saved response with interrupted follow-up work from an unpublished failed request. Preserve uncertain-write safety, pending action/responseRequest semantics and no automatic replay. Consider a bounded post-publication grace rather than merely raising the global limit; do not blindly declare all follow-up work complete.
2. Delegate the fresh action packet promptly and let the read-only referee retrieve missing rules, avoiding serial DM preparation before delegation where sufficient context already exists.
3. Verify supported child-model options explicitly before expecting the cost-aware guidance to choose a non-inherited model. Do not hardcode an unverified model.
4. Improve Antigravity telemetry fidelity: live records emitted tool-end entries without call IDs/start intervals, and define_subagent/invoke_subagent names were omitted by the allowlist. Backend measurements remain valid. Future adapter work should use the actual supported event schema rather than assuming synthetic fixture IDs.

## Verification and limitations
Compared event timestamps with both diagnostic files and read-only provider SQLite metadata; inspected timeout/host failure handling. A lower-cost read-only subagent independently confirmed the fixed deadline and publication-insensitive interruption path. No runtime/source changes, campaign mutations, retries, model calls or daemon changes performed. No test suites rerun for this investigation. Only this engineering note was added; no commit/push.
