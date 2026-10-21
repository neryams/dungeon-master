# Verification

Automated coverage includes atomic batches, duplicate-operation recovery, stale revisions, concurrent writers, replay after cache removal, interrupted temporary files, resource and inventory invariants, dice retries, corrections, map movement, public/private filtering, backup restore, invalid paths and archive entries, journal outage and lost acknowledgements, real MCP tool enumeration and a fresh stdio process resume.

The real journal integration uses the pinned upstream server and an isolated daemon. It intentionally uses an invalid embedding model identifier to test the upstream keyword-search fallback without downloading a model. This verifies journal persistence and retrieval, not vector quality or performance.

The acceptance scenario uses the original Lantern at Briar Ford adventure. It creates party/world state, records narrative details, resolves a potion and encounter, saves a checkpoint, restarts the service, and verifies exact continuation. This is a scripted playthrough, not an independent evaluation of model storytelling.

Client UI installation, skill auto-selection in a live conversation, model narrative quality, and cloud tunnel connectivity require testing in the target application/account. They are not claimed by the automated tests. No hosted endpoint has been deployed.

Run `npm run typecheck`, `npm test`, `npm run test:journal`, and `npm run package:plugin`. Skill frontmatter can also be validated with the skill-creator validator when available in the development environment.
