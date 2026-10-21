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
