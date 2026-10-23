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

`roll_dice` accepts `expression`, `purpose`, `mode` and `visibility`. All roll inputs and referee roll plans default to `party`; hidden rolls require an explicit `visibility: "dm"`. Actual rolls choose visibility independently of the referee plan and previous rolls, while expression, mode and purpose still follow the recorded procedure. This also applies to administrative rolls. Existing saved visibility is unchanged. Normal expressions are `NdM`, `NdM+K` or `NdM-K`, bounded to 100 dice and 10000 sides. Advantage/disadvantage requires one d20. Reported mode requires `reportedTotal` and stores the expression as the operator's label without generating dice.

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

Resume prioritizes focus, active quests, scene decision/progress, relevant NPC interactions, explicit party and maps containing its members. Legacy campaigns infer party from character entities. Resolved/dormant/abandoned quests stay readable by ID. Scene location is the viewpoint, not an automatic relocation of the roster. Overarching campaign secrets and future plans belong in `visibility: dm` scene records retrieved through `search_campaign_history` and `read_campaign_record`, keeping `resume_campaign` focused on immediate scene state.

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

`render_location_map` takes mapId, optional audience (dm/party), revision, mode (`map` or `reference`, default `map`) and viewport `{x,y,width,height}`. Width/height are 1–40 cells; default 20×20, clamped for smaller bounded maps. Legacy unbounded grids infer an origin from existing positions. Offscreen markers produce a warning. `mode=map` renders the normal schematic and composites the latest eligible registered background beneath live map details. `mode=reference` returns a clean terrain/layout PNG for host image generation: it has no transient character markers, title, legend or text labels, but keeps grid cell outlines and feature shapes as a geometry guide. The exact viewport is returned; when registered as a background extent, its image edges map to those map-coordinate cell boundaries. Both modes are read-only gameplay operations, though they persist derived files.

Successful map responses contain an image/png MCP block, structured positions visible inside the viewport, mapId, revision, audience, mode, viewport, warnings and campaign-relative path. Text responses do not repeat base64 data. PNGs live in `.dm/maps/` with revision/audience/mode/viewport-specific filenames. Local inspection of that path is a fallback for hosts without image display.

Movement commits before rendering. On failure, the response says `positions saved; rendering failed` and identifies the saved revision. Retry only `render_location_map` at that revision. Exact mutation retries replay the original event revision and return its image, with currentRevision separately reported. They never label a later image as the earlier operation.

`register_map_art` takes mapId and `art: {path, purpose, sourceRevision, visibility, background?}` plus mutation metadata. `background`, when present, is `{extent:{x,y,width,height}}` from the exact reference viewport used to generate the image. Extent maps the full image edges to the map-coordinate cell boundaries. Path must be an existing non-symlink file under assets/, up to 50 MiB and 40 million decoded pixels and recognized by Sharp as an image; sourceRevision must contain the map. The service records a SHA-256 content hash and a static geometry hash with the background metadata. At render time it uses the latest eligible background only when the content and map geometry hashes remain valid; otherwise it renders the schematic and reports a warning. Current markers, grid, labels and reveal masks are rendered over the image. Grid party views keep unrevealed cells opaque. Graph party backgrounds are withheld until every original node and edge is revealed; graph images must be authored entirely party-safe. Artwork is included in exports. The create-map-art skill uses host image generation when available, without model API fallback.

For party backgrounds, concealing a feature inside an otherwise visible cell (or a graph background extent) also withholds the artwork and falls back to the schematic. A painting cannot selectively erase that feature. Concealed grid features already covered by opaque cell fog do not suppress the rest of the background.

Low-level `set_map` ({id,map}), `set_positions` ({map,positions}), `set_reveal` ({map,revealed,nodes,edges,cells,regions,features}) and `register_art` ({map,art}) are typed reducer operations. Use the domain map tools for creation, asset file verification and rendering. To add bounds to an old grid, read its full map, preserve other fields and save `set_map` with explicit bounds/origin. Historical events remain unchanged. Legacy move_token retains its old replay semantics; use set_positions/new tools for same-level transfer behavior.

## Conversational sheets (0.3.0)

- `get_character_sheet`: `{characterId, audience?: "party" | "dm"}`. Returns campaign identity, revision, audience, the full visible character entity, `inventory` (all visible item entities owned by that character, including depleted stacks), and `placements`. Missing, hidden and non-character IDs return NOT_FOUND. NPCs use get_campaign_entity.
- `get_party_overview`: `{audience?: "party" | "dm"}`. Returns campaign identity, revision, audience, `rosterSource` (explicit or legacy-characters), and members with ID/name, HP/max/temp, AC, conditions, resources, visible inventory entry count and placements. Explicit roster order is preserved, including an empty roster; only legacy campaigns without a roster infer members from character entities.

Both new tools default to party audience. They read one authoritative state snapshot, filter it before joining records, and never search/flush the journal or mutate gameplay. Inventory is not capped by the resume packet's entity limit. Inventory entries are records/stacks, not a sum of quantities. Stable ID ordering makes inventories and placements predictable.

Placements include mapId/mapName, kind, regional/tactical level, scale and exact position. Graph placements include a node label and a linked location's ID/name when visible. Hidden maps, rooms and unrevealed grid positions are omitted. Empty placements mean no visible saved placement; scene location is never substituted. Multiple recorded placements are preserved, including legacy duplicates.

Use the player-sheet skill for identity resolution and concise answers. A map shown alongside a sheet should call render_location_map with the sheet's audience and revision. Later gameplay writes require another lookup for updated totals. There is no automatic update of already displayed chat messages, player authentication, or persistent panel in this increment.

## Local player panel

The CLI `panel --campaign DIR [--lan] [--port PORT]` provides a separate HTTP dashboard; it adds no MCP tools. Both `/api/state` and `/api/map` require the per-run bearer token from the printed access link. There is no audience parameter or write endpoint. State returns campaign identity, revision, party overview, full roster sheets, current focus/scene, active quests, visible map summaries and visible encounter order. Map requires `mapId` and `revision`; optional viewport requires all four integer fields `x`, `y`, `width`, `height` (size 1–40). It returns PNG and X-Campaign-Revision, or 409 to request a fresh snapshot. Hidden and absent maps both return 404. Renderer failure returns a generic retryable error without changing state.

## Referee workflow

These tools record host-provided review; they do not call a model. New writes retain operationId/expectedRevision/reason/actor semantics.

| Tool                   | Input and result                                                                                                                                                                                                                                                                                                                                                                                              |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| configure_review       | `mode`: legacy/setup/reviewed. Records an administrative transition; pending actions must be closed first.                                                                                                                                                                                                                                                                                                    |
| prepare_action         | `actionId`, `actors`, `targets`, optional `entityIds`, `intent`, `circumstances`. Saves a private packet and gameplay fingerprint. One pending action at a time.                                                                                                                                                                                                                                              |
| get_action             | `actionId`, audience (default dm). DM receives saved action, current packet and stale status. Party receives only an authored public explanation, otherwise NOT_FOUND.                                                                                                                                                                                                                                        |
| record_action_ruling   | `actionId`, `ruling` with verdict, reasoning, citations, missingFacts, costs, procedure, success/failure terms, roll steps and referee metadata. Stores pre-roll procedure; an allowed ruling cannot have unresolved missingFacts.                                                                                                                                                                            |
| amend_action_rolls     | `actionId`, additional `rolls`, referee metadata and citations. Explicitly appends new step IDs before rolling; does not alter existing terms.                                                                                                                                                                                                                                                                |
| approve_action_effects | `actionId`, `approval` containing exact `changes`, reasoning, citations, referee metadata and `skippedRolls`. All required dice must exist; each unused optional step requires a reason. Dry-runs the effects.                                                                                                                                                                                                |
| commit_action          | `actionId`, optional publicExplanation. Commits exactly the saved approval, never caller-supplied replacements.                                                                                                                                                                                                                                                                                               |
| cancel_action          | `actionId` and reason. Closes without erasing history or applying effects.                                                                                                                                                                                                                                                                                                                                    |
| supersede_action       | `actionId`, `replacementId` and reason; optional circumstances and additional entityIds. Refreshes stale context, retains original terms/dice, and requires a new ruling before approval.                                                                                                                                                                                                                     |
| administer_campaign    | Explicit bypass with purpose (override/delegation_unavailable/world_preparation/correction), ruling text, reason, optional actionId, changes, eventId correction link, and publicExplanation. Optional `roll` records administrative dice separately from effects. `closeAction=false` keeps a related action pending while declaring a procedure; default true closes it on a non-roll administrative event. |
| search_rules           | query, optional edition, limit 1–8. Offline lexical/phrase search of pinned official SRD pages.                                                                                                                                                                                                                                                                                                               |
| read_rules             | page, optional edition and count 1–3. One-based PDF pages, not printed page numbers.                                                                                                                                                                                                                                                                                                                          |

`roll_dice` accepts optional actionId and stepId. In reviewed play both are required, with the recorded expression/mode/purpose/visibility. For physical rolls use mode=reported and reportedTotal; totals must fit the declared expression. A step can be rolled once, even under a new operation ID. Recover lost responses using the original operation ID. Additional or altered rolls are not implicitly authorized.

Ruling verdicts are allowed/needs_clarification/not_possible/needs_dm_judgment. Citations contain source (srd-5.1/srd-5.2.1/house-rule/supplied-rule), reference text, and PDF page for SRD references. Referee identity contains host and model strings; unknown/inherited identity must be described honestly. Roll steps contain id/expression/mode/purpose/visibility/when/optional. See the rules-referee skill protocol for the full handoff and examples/referee-action.json for an illustrative potion procedure.

REVIEW_REQUIRED means use the reviewed action or administrative path. STALE_REVIEW means supersede and re-review preserved results; it never authorizes rerolling. INVALID_CITATION rejects mismatched editions/pages or nonexistent configured house rules. Shared ledger validation still rejects illegal quantities, missing entities, invalid coordinates and other corrupt state, including on administration.

## Desktop public narration

`publish_table_message` accepts normal mutation metadata (`operationId`, `expectedRevision`, `reason`, optional `actor`) plus `requestId`, public `text` (1–20,000 characters), and optional `responseRequest: { characterIds, prompt, kind }`. The kind is `decision` (default) or `reaction`, and character IDs must identify visible party characters. For unresolved choices/reactions, publish the prompt and end the current CLI turn before committing the affected outcome; resume only after the requested replies arrive. Use it only when a desktop host provides an active request ID. Save resolved mechanics first, then publish the player-facing outcome or question. Never publish DM plans, hidden entities, raw tool results or private referee discussion. It returns the committed event/revision and duplicate status through the normal MCP contract. Exact retries reuse the same operation ID and input.

The tool rejects missing/closed requests. Submitting and finishing requests are internal desktop coordinator operations, not additional model tools. The reducer enforces one pending table request and disallows mixing conversation events with gameplay effects. ChatGPT/Codex conversations continue using their ordinary assistant responses; they do not need this tool. Public table messages remain in event history and export/import, independently of journal delivery.
