# Conversational player sheets implemented with exact snapshot lookups

## Context and decisions

The user approved starting with conversational sheets after the player lookup proposal. Implemented two read-only tools and a player-sheet skill; a persistent panel, entity browser and authentication remain outside this increment. Work starts from published commit 948c8ea on feature/game-setup. Version is now 0.3.0.

## Completed changes

src/sheets.ts derives character sheets and compact party overviews from an already audience-filtered snapshot. src/service.ts exposes get_character_sheet(characterId, audience) and get_party_overview(audience), both defaulting to party. Each reads the authoritative store once, makes no journal call and performs no mutation. Sheets include full character data, every visible owned inventory record including depleted stacks, and all visible regional/tactical placements. Graph placements resolve visible linked location names. No scene fallback or silent relocation occurs. Explicit empty rosters remain empty; legacy campaigns infer characters.

src/server.ts marks the new tools read-only. skills/player-sheet/SKILL.md handles identity ambiguity, focused answers, fresh revision-stamped lookups, and map rendering at the same revision. skills/run-campaign/SKILL.md routes reference requests to these tools. README.md, docs/tools.md, docs/architecture.md and docs/verification.md document behavior and limitations. Package/manifest versions are synchronized.

## Verification actually run

npm test passed all 33 tests, including four new cases in test/sheets.test.mjs. They cover complete 114-entry inventory, a single store read, no journal calls or event writes, fresh damage/consumption totals after restart, hidden/planned items and map visibility, separate regional/tactical placements, empty and explicit rosters, legacy fallback, and MCP structured responses/read-only annotations. npm run typecheck passed. npm run test:journal passed in its isolated temporary workspace. The player-sheet skill validator passed. git diff --check passed. Final formatting and package generation are being completed with this entry included.

## Limitations and next steps

Live host skill auto-selection and player identity resolution have not been tested in an actual play conversation. Responses are snapshots and do not update existing chat messages. Larger inventories are returned completely and may require concise presentation by the agent. Visibility is a single trusted operator convention, not authenticated player access. Install the rebuilt plugin in a fresh campaign session and ask for a character sheet or party locations. No campaign data was written into this source repository. Changes are uncommitted; no new push was requested for this increment.
