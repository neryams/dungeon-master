# Verification

Automated coverage includes atomic batches, duplicate-operation recovery, stale revisions, concurrent writers, replay after cache removal, interrupted temporary files, resource and inventory invariants, dice retries, corrections, map movement, public/private filtering, backup restore, invalid paths and archive entries, journal outage and lost acknowledgements, real MCP tool enumeration and a fresh stdio process resume.

The real journal integration uses the pinned upstream server and an isolated daemon. It intentionally uses an invalid embedding model identifier to test the upstream keyword-search fallback without downloading a model. This verifies journal persistence and retrieval, not vector quality or performance.

The acceptance scenario uses the original Lantern at Briar Ford adventure. It creates party/world state, records narrative details, resolves a potion and encounter, saves a checkpoint, restarts the service, and verifies exact continuation. This is a scripted playthrough, not an independent evaluation of model storytelling.

Client UI installation, skill auto-selection in a live conversation, model narrative quality, and cloud tunnel connectivity require testing in the target application/account. They are not claimed by the automated tests. No hosted endpoint has been deployed.

Run `npm run typecheck`, `npm test`, `npm run test:journal`, and `npm run package:plugin`. Skill frontmatter can also be validated with the skill-creator validator when available in the development environment.

## Story and map increment verification

The 0.2.0 suite passes 29 tests. test/maps.test.mjs extends Briar Ford with an actionable opening objective, persisted ferryman topic resolution, group crossing and split positions, a fresh stdio MCP process, returned PNG image blocks, and export/import regeneration with byte-identical PNGs in the same environment. It also checks stale/duplicate requests, original-revision retries after later moves, injected renderer failure, independently filtered player SVG and pixel equivalence, explicit pressure triggers, same-level subgroup transfers, legacy unbounded grids, stable graph coordinates, concealed edges, asset validation, symlink rejection and compact 1,000×1,000 reveal masks. Existing event files remain unchanged when adding bounds.

The built-in image response was exercised through an MCP client and the returned PNG bytes were inspected visually: Mara is at (4,6), Tess at (5,8), and Mara has the active-turn highlight. Both DM and player images are readable. The player image masks unrevealed cells and omits the keeper cache and its legend entry. This verifies one concrete model-readable schematic; it is not a broad vision benchmark.

Typecheck, all 29 tests, the isolated real journal integration test, the three changed/new skill validators, and plugin packaging passed. The packaged CLI demo was run in a temporary campaign with an intentionally unavailable journal server, confirming durable narrative fallback and both map views without contacting the existing daemon. Optional host image generation and live skill auto-selection were not exercised. No model API calls were added.

## Conversational sheet verification (0.3.0)

The suite now passes 33 tests. test/sheets.test.mjs verifies one authoritative read per sheet, a complete 114-entry inventory beyond the resume cap, no journal calls or event writes, refreshed damage/item totals after reopening the campaign, audience filtering before joins, separate map levels, no scene-location substitution, explicit/empty/legacy rosters, and real MCP read-only annotations and structured results. Typecheck, the isolated journal integration test and the player-sheet skill validator pass. Live automatic skill selection and player identity resolution in the host UI still require a real play session.

## Local player dashboard (0.4.0)

The panel integration tests exercise a real HTTP listener on ephemeral ports: loopback and LAN binding, bearer authorization, token rotation, Host/Origin restrictions, rejected writes and audience overrides, blocked file routes, and security headers. They compare campaign file contents before/after dashboard and PNG reads, verify 120 inventory entries, regional/tactical and split-party placements, hidden maps/characters, active quest filtering, empty rosters, hidden encounter turns, saved revisions and restart consistency. Sharp output is compared with the filtered schematic. Injected renderer failure leaves campaign files untouched; a commit during rendering returns 409 instead of a mislabeled PNG. Unsafe viewport extents are rejected.

36 unit/integration tests and typecheck passed. The pinned journal integration passed in its isolated temporary workspace without touching the user's daemon. Browser inspection used a disposable prior test campaign: desktop sheets and bridge map, viewport selection and centering, a 390px responsive viewport (single column without page overflow), and disconnected snapshot labeling. Mobile screenshot capture was unreliable, so responsive dimensions were also checked from rendered DOM geometry. LAN HTTP was exercised using this host's interface address; a second physical computer/phone was not available. No automatic startup, internet hosting, individual player accounts, original-artwork serving, or gameplay editing is included.

## Rules referee (0.5.0)

The scripted workflow tests cover pre-roll requirements, exact step specifications, reported-roll bounds, duplicate recovery, required/optional dice, explicit amendments, exact approved atomic effects, direct-write guards (including replacement/map/correction paths), administrative fallback and invariant failures, stale re-review with preserved dice, pure narrative checkpoints, policy activation, legacy compatibility, private player filtering, and restart/export/import. An illustrative Briar Ford potion workflow resolves actual dice, consumes the potion, heals the character and records bonus-action use together. These tests validate protocol/state behavior, not a complete D&D engine.

A bounded host subagent, with no model override, independently read the rules-referee skill and pinned references for seven isolated cases. It rejected impossible jumping and unavailable slots/actions, preserved dangerous legal intent while asking for missing combat facts, rejected success after a saved failed roll, requested missing feature text, and checked the potion house rule. It identified a genuine 2014/2024 potion action-cost difference. The test deliberately supplied incomplete fixtures, so clarification verdicts are expected rather than fabricated statistics. It made no campaign mutations or external calls. Actual host delegation was exercised; an entire interactive live campaign with automatically selected skills was not.

That evaluation exposed poor rule-search ranking. Search now favors exact phrases and headings with term-frequency weighting; regression checks locate the jump glossary and potion equipment entry. Text extraction retains multi-column/table limitations; callers can inspect original PDF references when necessary. Source edition/page validation and checksums cannot verify that a citation logically supports a ruling.

One pending action is supported at a time. The server trusts supplied referee responses and fictional context; actor/model strings are not independent-authorship authentication. Complete action budgets, class features, collision/line-of-sight and spell resolution remain adjudicated rather than automatically enforced. The explicit administrative fallback is covered by tests, not by intentionally disabling a user's host capability.
