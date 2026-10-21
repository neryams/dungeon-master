# Tool interfaces

The exported Zod schemas in `src/service.ts` and `src/schema.ts` are the source of truth. Tools are bound to one campaign. All IDs use letters, digits, `_` and `-`; reserved prototype property names are rejected.

## Mutations

Every mutation takes `operationId`, `expectedRevision`, `reason` and optional `actor` (default `dm`). Generate a fresh operation ID for a new logical action; retain the exact input for retries. Revision comes from status, resume or the previous write. A roll is itself an event and advances the revision.

`apply_campaign_changes` accepts a batch of typed operations:

| Operation                  | Fields / behavior                                                                                          |
| -------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `put_entity`               | `entity`; replaces the complete entity; preserve existing fields when editing                              |
| `damage` / `heal`          | `id`, nonnegative `amount`; damage consumes temp HP first; healing caps at max HP                          |
| `set_temp_hp`              | `id`, `amount`; assigns the adjudicated temp HP value                                                      |
| `resource`                 | `id`, `resource`, signed `delta`; optional `overrideReason` explicitly raises max to an over-cap new value |
| `consume_item`             | Item `id`, positive `quantity`; rejects insufficient stock                                                 |
| `transfer_item`            | Item `id`, new character `owner`; transfers the whole stack                                                |
| `equip_item`               | Item `id`, `equipped`; empty stacks cannot be equipped                                                     |
| `item_charges`             | Item `id`, signed `delta`; preserves bounds                                                                |
| `condition`                | Character `id`, condition `name`, optional `duration` and `remove`                                         |
| `set_encounter`            | `encounter` with ordered participants, round and turn; `null` ends it                                      |
| `advance_turn`             | Advances one turn, increments round on wrap                                                                |
| `move_token`               | `map`, entity `id`; grid `x,y` or graph `node`                                                             |
| `set_scene`                | `scene` with ID, title, location/present/map references, summary and unresolved choices                    |
| `set_time` / `set_session` | Explicit fictional `time` string or `session` ID                                                           |

Partial item transfers are one batch that consumes from the source stack and creates/updates the destination stack. Rests and death-save changes are adjudicated by the DM and recorded using resources or a full character update. Currency, spell slots and hit dice use named resources such as `silver`, `spell-slot-1`, `hit-dice-d8`. Maxima are bookkeeping limits chosen by the campaign, not automatic rules.

`put_entity` supports character, NPC, item, location, faction, quest and map kinds. Characters contain ability scores, AC, HP/max/temp HP, proficiency, saves/skills, conditions, death saves and resources. Entity knowledge is `established`, `rumor` or `plan`, with `party` or `dm` visibility. Quest progress uses `status` and description. NPCs may also have character data.

`roll_dice` accepts `expression`, `purpose`, `mode` and `visibility`. Normal expressions are `NdM`, `NdM+K` or `NdM-K`, bounded to 100 dice and 10000 sides. Advantage/disadvantage requires one d20. Reported mode requires `reportedTotal` and stores the expression as the operator's label without generating dice.

`record_scene` takes title/content/visibility. `checkpoint_session` takes a public summary/unresolved array and optional private dmNotes. `correct_campaign_event` takes the original eventId and explicit compensating changes. Historical corrections should also get a new narrative record explaining which older account is superseded.

## Reads

- `campaign_status`: configuration, revision, session and delivery counts.
- `resume_campaign`: compact relevant current state plus recent record references and rolls; also retries journal delivery.
- `get_campaign_entity`: exact full entity by ID.
- `search_campaign_history`: query, optional limit, ranked record references and excerpts; status distinguishes unavailable retrieval.
- `read_campaign_record`: reference of the form `record:<uuid>`.

Read tools supporting visibility accept `audience: dm|party` (default dm). Player-facing generation should use party views. A public scene summary is not an appropriate place for DM secrets.

## Error handling

MCP errors contain a code and useful message, with field paths for input validation. `REVISION_CONFLICT` includes currentRevision. `OPERATION_REUSED` means the input differs from the saved operation. Invalid changes leave no partial event. Missing journal delivery produces a successful committed write with `journal.status=pending`; retry delivery, not the gameplay action. `INTERNAL_ERROR` may represent an uncertain commit: retry the exact operation ID and input.

## Story progress and party

| Operation          | Fields                                                                                                                                         |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `set_focus`        | `focus: {primaryObjective, activeQuestIds}`                                                                                                    |
| `set_party`        | `members`: explicit character IDs                                                                                                              |
| `set_quest`        | quest entity `id`, `quest: {objective, stakes, progress[], leads[], completionConditions[], status}`; status active/resolved/dormant/abandoned |
| `set_interaction`  | NPC `id`, `interaction: {wants[], knows[], disclosed[], offers[], unresolvedTopics[], resolvedTopics[], status: open or served}`               |
| `define_pressure`  | `pressure: {id, name, trigger, consequence, visibility}`; defines once                                                                         |
| `trigger_pressure` | pressure `id`, exact defined `trigger`, nonempty fictional `evidence`; increments occurrences and saves lastTrigger                            |

`set_scene` additionally accepts centralQuestion, progress[], pendingDecision and exitConditions[]. Fields describe public progress; put secrets in separate DM entities/records. NPC wants/knows/offers are private in party views; public disclosed and topic fields must not contain secrets. Pressures never advance implicitly. Quest and interaction updates replace their structured records: preserve prior progress and resolved topics when updating.

Resume prioritizes focus, active quests, scene decision/progress, relevant NPC interactions, explicit party and maps containing its members. Legacy campaigns infer party from character entities. Resolved/dormant/abandoned quests stay readable by ID. Scene location is the viewpoint, not an automatic relocation of the roster.

## Map authoring and rendering

`create_location_map` takes mutation metadata, `entity` (kind map), optional audience and viewport. Existing IDs are rejected. Grid maps require bounds `{width,height}` (1–1000), zero-based integer cells, upper-left origin, x right/y down; default scale is 5 feet per cell. Graph maps use nodes/edges and assign any missing drawing coordinates once into layout. Map level defaults to tactical for grids and regional for graphs.

Maps accept `locations` (node ID to location entity ID), `labels` (node ID to text), `features` ({id,x,y,label,kind:terrain|obstacle|landmark,visibility,revealed,location?}), `revealedCells` ({x,y}[]) and `revealedRegions` ({x,y,width,height}[]). Graph visibility uses revealed node IDs and optional revealedEdges pairs; omitted revealedEdges preserves legacy visibility for edges between revealed nodes. Links must reference location entities. Features on a player grid also require their cell to be revealed. New grids start concealed unless an explicit mask is supplied.

`update_map_positions` takes mapId, positions [{entityId,x,y}] or [{entityId,node}] and mutation metadata. Alternatively supply `group: {entityIds, position:{x,y}}` (or node) to move explicitly selected roster members together. Exactly one of positions/group is required. All placements commit atomically; omitted characters stay put. New placement removes that character from other maps at the same level, preserving placements at other levels. Shared cells are allowed. Movement distance and collision rules remain DM decisions.

```json
{
  "operationId": "crossing-turn-04",
  "expectedRevision": 27,
  "mapId": "river-crossing",
  "positions": [
    { "entityId": "mara", "x": 4, "y": 6 },
    { "entityId": "tess", "x": 5, "y": 6 }
  ],
  "audience": "dm",
  "reason": "The party advances onto the bridge"
}
```

`set_map_reveal` takes mapId, revealed boolean, optional nodes[], edges[] (node pairs), cells[], regions[], features[] plus mutation metadata; explicitly conceals/reveals only those targets. Masks stay as compact rectangles; concealing a cell splits its containing region without expanding the entire grid. No automatic line of sight.

`render_location_map` takes mapId, optional audience (dm/party), revision and viewport `{x,y,width,height}`. Width/height are 1–40 cells; default 20×20, clamped for smaller bounded maps. Legacy unbounded grids infer an origin from existing positions. Offscreen markers produce a warning. This is a read-only gameplay operation, though it persists a derived file.

Successful map responses contain an image/png MCP block, structured positions visible inside the viewport, mapId, revision, audience, viewport, warnings and campaign-relative path. Text responses do not repeat base64 data. PNGs live in `.dm/maps/` with revision/audience/viewport-specific filenames. Local inspection of that path is a fallback for hosts without image display.

Movement commits before rendering. On failure, the response says `positions saved; rendering failed` and identifies the saved revision. Retry only `render_location_map` at that revision. Exact mutation retries replay the original event revision and return its image, with currentRevision separately reported. They never label a later image as the earlier operation.

`register_map_art` takes mapId and `art: {path, purpose, sourceRevision, visibility}` plus mutation metadata. Path must be an existing non-symlink file under assets/, up to 50 MiB and recognized by Sharp as an image; sourceRevision must contain the map. Artwork is separate from schematic rendering and is included in exports. The create-map-art skill uses host image generation when available, without model API fallback.

Low-level `set_map` ({id,map}), `set_positions` ({map,positions}), `set_reveal` ({map,revealed,nodes,edges,cells,regions,features}) and `register_art` ({map,art}) are typed reducer operations. Use the domain map tools for creation, asset file verification and rendering. To add bounds to an old grid, read its full map, preserve other fields and save `set_map` with explicit bounds/origin. Historical events remain unchanged. Legacy move_token retains its old replay semantics; use set_positions/new tools for same-level transfer behavior.

## Conversational sheets (0.3.0)

- `get_character_sheet`: `{characterId, audience?: "party" | "dm"}`. Returns campaign identity, revision, audience, the full visible character entity, `inventory` (all visible item entities owned by that character, including depleted stacks), and `placements`. Missing, hidden and non-character IDs return NOT_FOUND. NPCs use get_campaign_entity.
- `get_party_overview`: `{audience?: "party" | "dm"}`. Returns campaign identity, revision, audience, `rosterSource` (explicit or legacy-characters), and members with ID/name, HP/max/temp, AC, conditions, resources, visible inventory entry count and placements. Explicit roster order is preserved, including an empty roster; only legacy campaigns without a roster infer members from character entities.

Both new tools default to party audience. They read one authoritative state snapshot, filter it before joining records, and never search/flush the journal or mutate gameplay. Inventory is not capped by the resume packet's entity limit. Inventory entries are records/stacks, not a sum of quantities. Stable ID ordering makes inventories and placements predictable.

Placements include mapId/mapName, kind, regional/tactical level, scale and exact position. Graph placements include a node label and a linked location's ID/name when visible. Hidden maps, rooms and unrevealed grid positions are omitted. Empty placements mean no visible saved placement; scene location is never substituted. Multiple recorded placements are preserved, including legacy duplicates.

Use the player-sheet skill for identity resolution and concise answers. A map shown alongside a sheet should call render_location_map with the sheet's audience and revision. Later gameplay writes require another lookup for updated totals. There is no automatic update of already displayed chat messages, player authentication, or persistent panel in this increment.

## Local player panel

The CLI `panel --campaign DIR [--lan] [--port PORT]` provides a separate HTTP dashboard; it adds no MCP tools. Both `/api/state` and `/api/map` require the per-run bearer token from the printed access link. There is no audience parameter or write endpoint. State returns campaign identity, revision, party overview, full roster sheets, current focus/scene, active quests, visible map summaries and visible encounter order. Map requires `mapId` and `revision`; optional viewport requires all four integer fields `x`, `y`, `width`, `height` (size 1–40). It returns PNG and X-Campaign-Revision, or 409 to request a fresh snapshot. Hidden and absent maps both return 404. Renderer failure returns a generic retryable error without changing state.
