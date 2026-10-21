# Story and map implementation kickoff from verified baseline

## Context

Read the prior design chat 01a15f38-c28f-7140-8988-66ec174f9569, README.md, docs/architecture.md and the baseline journal. Git working tree is clean. Current code has event-backed maps and move_token, but no renderer, explicit party roster or structured story progress. Prior verification is historical; no tests have been rerun yet.

## Decisions and planned work

Implement optional schema additions without editing historical events. Keep every gameplay mutation in CampaignStore.transact and typed reducers. Preserve original operation IDs and render replayed event revisions for duplicate positional requests. Use direct Sharp dependency and independently filtered player rendering. Store original artwork in assets and derived PNGs in .dm/maps. Host image generation remains a skill workflow with no API calls.

## Next steps

Implement story records and opening workflow, map validation and movement, PNG/MCP responses, split-party visibility, artwork skill, example and acceptance tests. Run npm test, npm run typecheck and isolated npm run test:journal. Keep changes and journal entries uncommitted for review.
