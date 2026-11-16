# Area Map Creation in Reviewed Play and Automatic UI Map Switching

## Context

Inspection of `/Users/ray/Campaigns/the-witch-on-iron-hill` (at revision `146`, base repo commit `ce26d4f`) showed why the party remained displayed on the starting `Hollow-Pines Campsite` map after transitioning to `The Sunken Slag-Shaft`:

1. **Tooling / review-guard trap (`src/service.ts`, `src/review.ts`)**: `create_location_map` and `update_map_positions` emitted mechanical changes without a `review` field, causing `validateReview` to reject them with `REVIEW_REQUIRED` whenever `state.reviewMode === 'reviewed'`. Because new campaigns enter `reviewed` mode immediately after opening verification, `create_location_map` was blocked during active play. Furthermore, `create_location_map` did not accept top-level `positions` or link the new map to `state.scene.map`.
2. **UI map-selection bug (`desktop/app.ts`, `desktop/lan.ts`, `src/panel-ui.ts`)**: The desktop renderer, LAN client, and read-only panel only reselected a map when the current `selectedMap` disappeared from `state.maps`. Because earlier maps stay in `state.maps`, transitioning `scene.map` or moving the party to a new tactical map never switched the visible map.
3. **DM skill gap (`skills/run-campaign/SKILL.md`, `skills/create-map-art/SKILL.md`)**: `run-campaign` lacked explicit instructions to create a new tactical map with `create_location_map` on area/scene transitions and to commit the schematic map first (publishing a `delivery="progress"` beat before generating illustrated artwork).

Note: `project_journal` MCP tools were not loaded in this session, so this entry was written directly to `docs/journal/` per the fallback documented in `AGENTS.md`.

## Decisions and Rationale

- **Reviewed-mode `world_preparation` in `create_location_map` and out-of-combat `update_map_positions` (`src/service.ts`)**:
  - Added optional `positions` (merged with `entity.map.tokens`, rejecting duplicate entity IDs) and `setSceneMap` to `inputs.create_location_map`.
  - In `create_location_map`, when `state.reviewMode === 'reviewed'`, the transaction automatically attaches `review: { type: 'admin', purpose: 'world_preparation', closeAction: false, ... }`. When an active `state.scene` exists, `setSceneMap` updates `state.scene.map` to the newly created map (defaulting to `true` for party-visible tactical maps in `reviewed` mode or when `state.scene.map` is unset, while preserving legacy/setup behavior when `scene.map` is already populated).
  - Added optional `setSceneMap` to `inputs.update_map_positions`. When `state.reviewMode === 'reviewed' && !state.encounter`, `update_map_positions` attaches the same `world_preparation` review metadata; when an active combat encounter exists (`state.encounter`), `update_map_positions` continues to omit `review` so tactical combat movement remains enforced by `commit_action` or `administer_campaign` (`REVIEW_REQUIRED`).
  - Added `update_map_positions` to the `Saving outcome` phase in `src/desktop/activity.ts`.
- **Automatic UI map switching with manual-selection preservation (`desktop/dom.ts`, `desktop/app.ts`, `desktop/lan.ts`, `src/panel-ui.ts`)**:
  - Added `resolveActiveMap()` in `desktop/dom.ts` (reused by `desktop/app.ts` and `desktop/lan.ts`, with matching logic in `src/panel-ui.ts`).
  - The UI switches to `scene.map` whenever `scene.map` changes to a visible map, else switches to the party's current tactical map whenever that placement changes, else falls back only if the currently viewed map is no longer in `state.maps`. When neither `scene.map` nor the party's tactical placement changes across revisions, manual dropdown choices stay intact.
- **Schematic-first area-transition pacing (`skills/run-campaign/SKILL.md`, `skills/create-map-art/SKILL.md`, `docs/tools.md`, `docs/architecture.md`)**:
  - Instructed the DM to call `create_location_map` (with `bounds`, `features`, `revealedRegions`, initial `tokens`/`positions`, and `setSceneMap=true`) before `prepare_action` or after `commit_action`, publish a `publish_table_message(delivery="progress")` beat immediately when continuing into `create-map-art` or further turns, and then generate/register the illustrated background before `delivery="response"`.

## Completed Changes

- `src/service.ts`: Updated `create_location_map` and `update_map_positions` schemas, descriptions, `setSceneMap` scene linking, `positions` merging, and reviewed-mode `world_preparation` recording (gated on `!state.encounter` for `update_map_positions`).
- `src/desktop/activity.ts`: Included `update_map_positions` in `phaseFor()` (`Saving outcome`).
- `desktop/dom.ts`, `desktop/app.ts`, `desktop/lan.ts`, `src/panel-ui.ts`: Added automatic map switching on `scene.map` or party tactical placement changes while preserving manual selection when unchanged, and reset viewport/pan offsets on switch.
- `skills/run-campaign/SKILL.md`, `skills/create-map-art/SKILL.md`, `docs/tools.md`, `docs/architecture.md`: Documented mid-session `create_location_map`, out-of-combat `update_map_positions`, and schematic-first / `delivery="progress"` pacing.
- `test/referee.test.mjs`, `test/maps.test.mjs`, `test/referee-model.test.mjs`, `test/desktop-ui.mjs`: Added unit, guard, skill-regression, and Electron desktop UI tests covering reviewed-mode `create_location_map`, non-combat vs. active-encounter `update_map_positions`, `resolveActiveMap`, and automatic `#map-select` switching.

## Verification

- `TMPDIR=/private/tmp npm run typecheck`: passed.
- `TMPDIR=/private/tmp npm test`: passed (269 tests passing).
- `TMPDIR=/private/tmp npm run test:journal`: passed (1/1 passing).
- `TMPDIR=/private/tmp node --test test/desktop-ui.mjs`: passed (1/1 passing).

## Known Limitations and Next Steps

- `/Users/ray/Campaigns/the-witch-on-iron-hill` was intentionally left unmodified by this work (initially inspected at revision `146` with only `Hollow-Pines Campsite` saved). Reconnecting the desktop host refreshes `.dm/hotseat/workspace/.agents/skills/` so the DM sees the updated `run-campaign` and `create-map-art` skills and can create new area maps on subsequent turns.
- The browser-based `test/lan-ui.mjs` suite was not run in this pass (`lan.ts` and `panel-ui.ts` updates are covered by `typecheck` and `panel.test.mjs` / `resolveActiveMap` unit tests).
