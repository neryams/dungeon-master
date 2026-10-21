# Rules referee workflow and reviewed-play guards implemented

## Context and decisions

The user approved bounded host referee review using the primary model, pre-roll procedures, post-roll approval of exact effects, explicit administrative bypass, a clearly marked unavailable-delegation fallback, and edition-matched official SRD references. Implementation starts from 0cb90e6. New CLI campaigns record setup mode and the opening skill transitions to reviewed play; existing campaigns remain legacy until enabled. No model API or persistent side conversation was introduced.

## Completed changes

src/referee-service.ts exposes action preparation/read, ruling, amendment, approval, commit, cancellation, supersession, policy and administrative tools. src/review.ts enforces write guards from the typed reducer, including raw replacement, movement, map creation and correction paths. Rules are recorded before dice; linked roll steps enforce specifications, required-step ordering, reported-total bounds and single-step execution. Exact retries recover committed results. Approval dry-runs exact effects; commit applies only those effects atomically. Gameplay fingerprints reject stale review, while narrative-only records do not invalidate it. Supersession retains dice and original terms, refreshes current context and requires re-review. Changing outcome terms after dice requires explicit administration.

Review policy/action records are optional schema-version-1 additions; events are never rewritten. Private review data is excluded from party state, dashboard and player resume. Public action lookup returns only an authored explanation. One action is pending at a time. Administrative dice and effects are separate events; closeAction=false allows a procedure to be recorded before resolution.

Added the rules-referee skill/protocol and updated setup/play skills. Bundled pinned SRD 5.1 and 5.2.1 extracted text with attribution, source/PDF/text checksums and runtime page-array checksum verification. Local rules search/read uses no journal or network. Search was improved after independent evaluation to prioritize phrases/headings. Added an illustrative reviewed potion procedure and automated Briar Ford resolution test. Documentation and package metadata are 0.5.0.

## Verification actually run

npm test passed 44 tests, including MCP transport calls for rules lookup/policy/action preparation; reviewed workflow, retries, invalid effects, guards, explicit fallback, stale supersession with new inventory and preserved rolls, conditional steps, player privacy, restart and export/import. npm run typecheck, format:check, git diff --check, three skill validators and package:plugin passed. npm run test:journal passed with its isolated temporary runtime. Packaging includes the offline rules corpus.

A bounded host subagent with no model override read the skill and actual rules references for seven isolated behavioral cases. It rejected impossible jumping, unavailable resources/actions and success after a failed roll; preserved dangerous legal intent while requesting missing combat facts; and identified missing feature text and a real potion action-cost difference between editions. It made no mutations or external calls. These were independent fixture reviews, not a fully interactive campaign or proof of universal rules accuracy.

## Limitations and next steps

The plugin records host-provided findings; host/model strings do not authenticate independent authorship. Workflow enforcement does not prove semantic correctness, supplied fictional facts, conditional roll eligibility or rule-citation relevance. Turn budgets, speed, feature text and exceptional rules remain supplied context/adjudication, not a complete combat engine. Multi-column PDF extraction can need original-page inspection. One pending action simplifies this increment; interrupted/reaction-heavy sequences need explicit supersession or administration. Existing campaigns require explicit activation. Changes remain uncommitted and no push was requested. Regenerate the final archive with this engineering note included.
