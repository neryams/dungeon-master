# Configurable Primary and Adjudicator Models in Lobby and Model Switcher

## Context

Investigation of recent campaign turns showed that Antigravity's native subagent delegation (`run_workflow` `agent(..., model=...)`) only accepts abstract subagent tiers (`inherit`, `flash`, `flash_lite`, `pro`) rather than concrete `agy models` IDs (`gemini-4-hydrogen-medium`), whereas Codex's `model/list` returns base model IDs (`gpt-6.1-sol`, `gpt-6-luna`) alongside `supportedReasoningEfforts` (`low`, `medium`, `high`, `xhigh`, `max`, `ultra`) and requires `fork_turns="none"` on `spawn_agent` when overriding child `model` or `reasoning_effort`.

To make both the primary DM model and the bounded `rules-referee` adjudicator model configurable across providers as model catalogs evolve, we expanded the model catalog, session persistence, referee instruction builder, lobby UI, and in-game model switcher dialog.

## Decisions and Rationale

1. **Antigravity Primary and Adjudicator Selection**:
   - Primary model dropdown lists the discovered `agy models` catalog and defaults to `gemini-4-argon-medium` when available.
   - Adjudicator dropdown lists Antigravity's four supported native workflow subagent tiers (`flash`, `flash_lite`, `inherit`, `pro`) and defaults to `flash`.
2. **Codex Reasoning Effort Expansion and Adjudicator Selection**:
   - `discoverCodex` expands `supportedReasoningEfforts` from `model/list` into `<model>:<effort>` catalog entries (for example `gpt-6.1-sol:high` -> `"GPT-6.1-Sol (High)"`, `gpt-6-luna:medium` -> `"GPT-6-Luna (Medium)"`), while preserving bare `<model>` entries when `supportedReasoningEfforts` is absent.
   - `CodexSession` parses `<model>:<effort>` via `parseCodexModelId`, validates both the base model and reasoning effort against the live `model/list` catalog before starting or resuming a thread, sets `config.model_reasoning_effort` to the selected effort, and passes the base model ID to `thread/start`, `thread/resume`, and `turn/start`.
   - Primary model defaults to `gpt-6.1-sol:high` (or `gpt-6-sol:high`) and adjudicator model defaults to `gpt-6-luna:medium` (or `gpt-5.6-luna:medium`), with an explicit `inherit` option in the adjudicator selector.
   - When a non-inherited Codex adjudicator model is configured, `selectRefereeModel` instructs the primary agent to pass `fork_turns="none"`, `model="<baseModel>"`, and `reasoning_effort="<effort>"` to `spawn_agent`.
3. **Session Persistence and Context Isolation**:
   - Added `refereeModels` to desktop preferences and `refereeModel` to `CampaignSnapshot` and the campaign's saved session locator (`session.json` / `codex-session.json`).
   - Switching either the primary model or the adjudicator model starts a fresh provider conversation while keeping campaign event history intact.

## Completed Changes

- `src/desktop/contracts.ts`: Added `refereeModels` preference storage, `refereeModel` on `CampaignSnapshot`, `selectRefereeModel` desktop API method, and optional `refereeModel` arguments on `WorkerApi.connect` and `DesktopApi.switchModel`.
- `src/desktop/models.ts`: Added `REASONING_EFFORTS`, `ANTIGRAVITY_REFEREE_CATALOG_MODELS`, `parseCodexModelId`, `resolveDefaultPrimaryModel`, `resolveDefaultRefereeModel`, and `supportedReasoningEfforts` expansion in `discoverCodex`.
- `src/desktop/codex.ts`: Parsed `<model>:<effort>` selections, validated reasoning efforts against `model/list`, and applied `model_reasoning_effort` overrides.
- `src/desktop/referee-model.ts`: Extended `selectRefereeModel` with `preferredModel` support for Antigravity workflow tiers and Codex `spawn_agent` (`fork_turns="none"`, `model`, `reasoning_effort`).
- `src/desktop/host.ts`, `desktop/main.mts`, `desktop/preload.cts`: Wired `refereeModel` validation, preference persistence, session locator persistence, and prompt injection.
- `desktop/index.html`, `desktop/app.css`, `desktop/app.ts`: Added `#provider-referee-model` in the lobby and `#switch-referee-model` in `#model-dialog` with provider-specific options and defaults.
- `test/model-catalog.test.mjs`, `test/codex.test.mjs`, `test/referee-model.test.mjs`, `test/model-selection.test.mjs`, `test/desktop-contracts.test.mjs`: Added unit and contract tests covering reasoning-effort expansion, default resolution, `<model>:<effort>` session validation, `preferredModel` referee instructions, and `refereeModel` session persistence.

## Verification

- `npm run typecheck`
- `TMPDIR=/private/tmp npm test`
- `TMPDIR=/private/tmp node --test test/desktop-ui.mjs`

## Known Limitations and Next Steps

- Antigravity's native subagent tool (`run_workflow` `agent(...)`) currently restricts child model selection to the four abstract tiers (`inherit`, `flash`, `flash_lite`, `pro`); if a future `agy` release accepts concrete model IDs for subagents, `checkRefereeModel` and `fillRefereeModels` can be updated to expose the full `agy models` catalog.
