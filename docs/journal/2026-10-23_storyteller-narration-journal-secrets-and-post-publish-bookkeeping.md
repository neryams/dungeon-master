# Storyteller narration, journal-backed secrets, and post-publish bookkeeping

## Context

Following review of the `0e048e0` checkpoint (`codex/dm-knowledge-disclosure`), we identified three issues with the structured `state.knowledge` ledger and negative-constraint narration guidance:

1. Dumping up to 100 `KnowledgeFact` records (including canonical `truth` and `discoveryHints`) into `resume_campaign` on every turn placed secrets directly in the narrator's active context while asking the model to ignore them, and permanently pinned party-disclosed facts in `resume_campaign`.
2. Requiring `get_campaign_knowledge` reads and full-fact `set_knowledge` replacements added tool-call overhead and invalidated pending action fingerprints.
3. Frame-by-frame negative prompt rules ("do not call it poison", "only give sensory evidence", "do not offer suggestions unless stuck") risked ungrounded "pixel-bitching" scenes and duplicated instructions across `skills/run-campaign/SKILL.md` and `src/desktop/narration-guidance.ts`.

`project_journal` MCP tools are unavailable in this session, so this entry was written directly to `docs/journal/` per `AGENTS.md`.

## Decisions and rationale

- **Remove `state.knowledge` and use a "bit of both" memory split**:
  - Overarching campaign secrets, world truths, and off-screen plans belong in `visibility=dm` journal records (`record_scene`) and session checkpoint `dmNotes`, retrieved on demand via `search_campaign_history` and `read_campaign_record`. `resume_campaign` surfaces only compact `recentRecords` references (`record:<id>` and title), keeping full secret prose out of default context.
  - Immediate scene context stays in `resume_campaign`: `scene` (`summary`, `centralQuestion`, `progress`, `pendingDecision`, `unresolved`), `focus`, `activeQuests`, and `interactions` scoped to NPCs relevant to the active scene/encounter.
- **Reframe narration around positive, character-grounded storytelling**:
  - Narrate from the active characters' perspective, including what their background, skills, and instincts naturally tell them while withholding facts and motives they have no reason to know yet.
  - Interpret player intentions generously to maintain momentum rather than stalling on minor clarifications.
  - Keep responses concise (typically 1–3 short paragraphs) with clear interactive hooks and open prompts rather than predetermined solution menus.
- **Fast turn pacing (mechanics before publish, narrative bookkeeping after)**:
  - Commit mechanical outcomes (`commit_action`, `apply_campaign_changes` for HP/resources/items/conditions, `update_map_positions`) before `publish_table_message` so sheets and maps are immediately accurate when narration appears.
  - Allow non-mechanical narrative/journal bookkeeping (`record_scene`, story summary/quest/interaction updates) to follow `publish_table_message` at meaningful scene boundaries (preserving `LocalMemoryGuard`'s pre-publish requirement in local Ollama mode).

## Completed changes

- Removed `KnowledgeFact`, `KnowledgeDisclosure`, `set_knowledge`, `State.knowledge`, and `get_campaign_knowledge` from `src/schema.ts`, `src/domain.ts`, `src/review.ts`, `src/service.ts`, `src/server.ts`, and deleted `test/knowledge.test.mjs`.
- Updated `src/desktop/narration-guidance.ts`, `src/desktop/host.ts`, `skills/run-campaign/SKILL.md`, `skills/create-campaign/SKILL.md`, `skills/close-session/SKILL.md`, and `skills/rules-referee/SKILL.md` to reflect character-grounded storytelling, journal-backed secrets, and post-publish narrative bookkeeping.
- Updated `README.md`, `docs/architecture.md`, `docs/tools.md`, and `AGENTS.md`.
- Added regression coverage in `test/gameplay.test.mjs` and `test/hotseat.test.mjs` for scene-scoped `interactions`, journal-record omission from `resume_campaign`, immediate snapshot visibility upon `publish_table_message`, and post-publish `record_scene` bookkeeping.

## Verification

- `npm run typecheck` and `npm run build` passed.
- `TMPDIR=/private/tmp npm test` passed (170/170).
- `TMPDIR=/private/tmp npm run test:journal` passed (1/1) using its isolated daemon/workspace.

## Known limitations and next steps

- Prompt guidance shapes model storytelling behavior but is not an automatic semantic spoiler filter.
- Run a live hotseat playthrough to evaluate turn responsiveness and narrative tone in practice.
