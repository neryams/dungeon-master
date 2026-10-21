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
