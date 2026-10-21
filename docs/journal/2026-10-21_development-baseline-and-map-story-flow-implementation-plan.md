# Development baseline and map story-flow implementation plan

## Context and completed baseline

The public repository is https://github.com/neryams/dungeon-master. Initial implementation was published at commit 6adb4c531c99aab26a20ae339f95c3228a2de63e. It exposes D&D domain tools, authoritative event-backed current state, internal journal-rag campaign history, four campaign skills, local setup, and export/import. No model API calls. Campaign workspaces remain separate from this source repository.

Prior baseline verification reported 20 tests plus one isolated real-journal integration test passing, typecheck, plugin packaging and skill validation. App plugin discovery and hosted connections were not verified. The real-journal test exercised keyword fallback, not vector retrieval quality.

## Development journal setup

The user requested a separate journal MCP in this source project before map implementation. journal-rag.config.json indexes docs/journal; .journal-rag is ignored. npm run journal:setup generates a machine-local ignored .codex/config.toml using the existing pinned journal-rag dependency. AGENTS.md documents search-before-work and recording decisions, changes, checks, limitations and next steps. Development agents may use these raw journal tools; gameplay agents still use D&D domain tools only.

## Planned work — not implemented

1. Campaign opening: collect tone, edition, preferences and party bonds. Establish one central conflict, a compact home area (4–6 locations, 3–5 NPCs), an immediate objective, stakes, several approaches and multiple paths to essential clues. Separate player briefing from DM secrets and future plans.
2. Story progress: persist campaign focus, active objectives, quest states (active/resolved/dormant/abandoned), leads, completion conditions, scene question/progress/pending decision/exit conditions, and NPC wants/known/disclosed/offers/unresolved topics. Pressure advances on explicit fictional triggers, not every conversational turn. Resume prioritizes current focus. Skills summarize exhausted topics, support meaningful roleplay and player agency, and offer concrete next steps without loops.
3. Map state: preserve graph maps and add bounded grid maps, origin/scale, landmarks, terrain and visibility. create_location_map, update_map_positions, render_location_map and set_map_reveal are proposed tool names. Batch marker updates are atomic, preserve omitted characters, reject unknown entities/out-of-bounds coordinates, allow distinguishable shared cells, and leave movement adjudication to the DM. Use zero-based integer cells, upper-left origin, x right/y down, default 5 feet. Model party membership, group movement, split parties, and separate regional/tactical placement scopes.
4. Rendering: deterministic SVG rasterized with Sharp (promote existing transitive dependency to direct). Save PNGs under .dm/maps with revision/audience/viewport identity and return actual MCP image/png content plus structured positions/path/revision. Include grid, coordinates, stable markers and legend, scale and active turn. Default 20x20 viewport. Commit positions before render; a render failure must not roll back or duplicate movement. Render retries must identify the correct state revision.
5. Optional artwork: the DM agent can invoke host ChatGPT image generation when available; MCP cannot directly call that host tool. No paid API fallback. A proposed create-map-art skill uses structured map context, stores selected local artwork under campaign assets, and registers audience/source revision. Initially show artwork separately, without assuming exact grid alignment or compositing generated art into tactical maps.
6. Visibility and compatibility: independently filter DM and party map data before rendering, including legends and hidden coordinates/features. Explicit reveal masks, no automatic line of sight. Preserve old events with optional schema defaults. Infer a viewport for legacy unbounded grids. Back up original artwork; derived PNGs regenerate after restore.

## Implementation order and acceptance

Implement story schemas/opening skill; map schemas/atomic position tools; renderer and MCP image results; group movement/splits/visibility; optional host artwork skill; examples/docs/package. Extend Lantern Ford through opening, a completed ferryman interaction, bridge movement, party split, audience views, and fresh-session resume.

Verify clear opening objective, no repeated resolved NPC topics after restart, correct PNG marker cells, stale revisions/idempotence/render-failure behavior, split-party consistency, no hidden data in player pixels or legends, replay/export restoration, and a DM agent identifying positions by inspecting returned image pixels.

## Next steps

Finish verifying this development journal connection and record results. Map/story-flow implementation has not begun; preserve this plan for the next implementation request. Keep journal entries and code reviewable; no automatic commit or push.
