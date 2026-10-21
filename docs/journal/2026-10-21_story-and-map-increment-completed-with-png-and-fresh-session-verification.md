# Story and map increment completed with PNG and fresh-session verification

## Context and decisions

Implemented the approved story-flow/map increment from chat 01a15f38-c28f-7140-8988-66ec174f9569. All gameplay changes use typed event reducers and CampaignStore.transact. Optional fields preserve old schemaVersion 1 campaigns; old events are unchanged. The plugin/package version is 0.2.0, with Sharp promoted to a direct dependency.

## Completed changes

- src/schema.ts and src/domain.ts: campaign focus, explicit party roster, quest and scene progress, NPC resolved topics, explicit pressure definitions/triggers; graph/grid metadata, location links, reveal masks and edges, atomic positional updates and same-level subgroup transfers.
- src/maps.ts: stable SVG schematic drawing, PNG conversion, coordinates, marker shapes/colors/legend, active-turn highlight, viewport support, independently filtered player views and campaign-relative derived artifacts. Shared-cell markers remain within the cell. Large reveal masks use rectangle subtraction rather than expansion into millions of cells.
- src/service.ts and src/server.ts: five map/art tools and actual MCP image/png blocks plus structured metadata. Duplicate mutations render their original event revision; failures preserve saved positions and support render-only retry. Artwork files are validated under assets and displayed separately.
- skills/create-campaign, skills/run-campaign and skills/create-map-art: staged actionable opening, durable interaction progress/pacing and optional host-generated art without API fallback.
- examples/lantern-ford.json and src/cli.ts: opening area, briefing/private reference, completed ferryman interaction, bridge crossing, split positions and both audience views. Documentation describes tool contracts, compatibility and verification limits.

## Verification actually run

npm test: 29 passed. npm run typecheck: passed after final renderer change. npm run test:journal: isolated real pinned journal MCP test passed, without stopping/reconfiguring the existing daemon. Skill validators passed for all three changed/new skills. git diff --check and npm run format:check passed. Packaging passed before final mask/marker refinements and is being refreshed with the final files.

Tests cover fresh stdio resume, actual MCP pixels, exact duplicate/stale requests, renderer failure after commit, hidden-data pixel equality, group/split movement, compact large masks, graph layout/edge visibility, legacy bounds updates, symlink/asset validation, original artwork export and byte-identical same-environment PNG regeneration after import.

Inspected returned MCP PNG bytes in a temporary campaign: Mara at (4,6), Tess at (5,8), Mara highlighted as active. Player view omitted the keeper cache and concealed unrevealed cells. Also inspected a saved shared-cell operation: both markers are visibly distinct in (4,6). Packaged CLI demo ran successfully in a temporary campaign at revision 8 with an intentionally unavailable journal server, exercising narrative fallback without contacting the user's daemon.

## Limitations and next steps

Host image generation itself and live skill auto-selection remain untested; the optional skill and registration path are implemented. Model storytelling quality is not established by scripted acceptance tests. PNG byte equality assumes the same renderer/font environment. Automatic line of sight, collision/movement-rule enforcement and art-to-grid alignment remain intentionally outside scope. Review the local diff and install the rebuilt plugin in a fresh campaign session. No commit or push was performed.
