# Referee and DM skill turn-speed optimizations

## Context

Analysis of a 10-minute hotseat turn timeout (at base commit `48dec0d`) identified several compounding prompt and skill bottlenecks during reviewed multi-actor combat turns:

1. **Pre-roll referee subagent overhead (~181s)**: Despite receiving the full `prepare_action` packet and output schema in its prompt, the delegated referee subagent called `get_action`, called `read_file` on `SKILL.md` and `references/protocol.md`, executed 12 sequential single-tool turns (`7x search_rules`, `5x read_rules`) looking up basic combat definitions (`Attack Action`, `Melee Attacks`, `Damage Rolls`, `Critical Hits`, `Dropping to 0 HP`) even though the weapon statistics and target AC/HP were already stated in the supplied packet, and generated a verbose multi-paragraph JSON ruling (~73s).
2. **Redundant post-roll referee subagent round-trip (~174s)**: Even when the actual dice rolls matched the pre-roll ruling's established procedure without any new rules ambiguity, the primary DM spawned a second post-roll referee subagent before calling `approve_action_effects` and `commit_action`.
3. **Sequential dice rolls and unannounced multi-turn chaining**: Rolling one step per LLM turn and immediately preparing and delegating a routine minion turn without first publishing the player character's resolved combat beat (`publish_table_message(delivery="progress")`) or using `administer_campaign` for a routine monster attack pushed total turn wall time past the 600s deadline.

Note: `project_journal` MCP tools were not loaded in this session, so this entry was written directly to `docs/journal/` per the fallback documented in `AGENTS.md`.

## Decisions and rationale

- Update `skills/rules-referee/SKILL.md` and `skills/rules-referee/references/protocol.md` so that when the delegating prompt supplies the fresh `prepare_action` packet and output contract, the referee uses them directly without calling `get_action` or `read_file` on `SKILL.md` / `protocol.md`.
- Instruct the referee to use `supplied-rule` citations for standard attacks, checks, saves, and features whose mechanics and numbers are already stated on supplied entities/items, avoiding redundant SRD searches for basic combat definitions. Restrict `search_rules` and `read_rules` to genuinely ambiguous or missing rules (or a single batched lookup turn when an exact SRD section citation is needed), and require batching multiple `search_rules` / `read_rules` calls in parallel within one turn.
- Require concise (1–2 sentences each) `reasoning`, `costs`, `procedure`, `success`, and `failure` fields in referee rulings and approvals.
- Update `skills/run-campaign/SKILL.md` so that:
  - When actual rolls follow the pre-roll ruling's established procedure without new rules ambiguity, the primary DM directly calls `approve_action_effects` (passing `approval` as a JSON object, reusing the pre-roll citations and referee identity, and listing unrolled optional steps in `skippedRolls`) and `commit_action` without spawning a second post-roll referee subagent.
  - For routine monster or NPC combat turns whose attack modifiers, damage expressions, and effects are already defined in saved campaign state, the primary DM may adjudicate directly with `administer_campaign` (`purpose="override"`) without spawning a subagent workflow (and closes any already-prepared `pendingActions` entry via `actionId` or `cancel_action`).
  - The DM calls `roll_dice` in parallel within a single turn whenever multiple roll steps can be rolled together.
  - After committing a PC's combat action (`commit_action`), if the DM continues resolving subsequent NPC/monster turns in the same request, it publishes the PC's resolved beat with `publish_table_message(delivery="progress")` first.
- Verified that an interrupted table turn with an already-committed PC action and a freshly prepared (`status: "prepared"`, non-stale, 0 rolls) NPC action requires no cleanup event before resuming in place, because `table` lifecycle events are excluded from `gameplayFingerprint(state)`.

## Completed changes

- Updated `skills/rules-referee/SKILL.md` and `skills/rules-referee/references/protocol.md` to eliminate redundant `get_action` / `read_file` calls, avoid basic SRD lookups when stats are supplied, enforce parallel batched `search_rules` / `read_rules` calls, and keep text fields to 1–2 sentences.
- Updated `skills/run-campaign/SKILL.md` to eliminate the redundant post-roll subagent round-trip when rolls follow the pre-roll procedure, permit direct `administer_campaign` resolution for routine monster/NPC turns, parallelize `roll_dice` calls, and publish `delivery="progress"` after a PC's `commit_action` before chaining into monster turns.
- Added prompt/skill regression assertions in `test/referee-model.test.mjs`.

## Verification actually run

- `TMPDIR=/private/tmp npm run typecheck`: passed.
- `TMPDIR=/private/tmp npm test`: passed.

## Known limitations and next steps

- Reconnecting the desktop host copies the updated `skills/` into the campaign's `.dm/hotseat/<provider>/.agents/skills/` workspace and injects the updated `SKILL.md` text into subsequent turn prompts.
