# Electron guided campaign creation implemented and verified live

## Context and decisions

The user authorized a new branch and commit for the dropdown fixes, then requested a DM-led Electron campaign creation wizard matching the plugin's open-ended setup. Created codex/electron-campaign-setup and committed the existing dropdown/layout fixes and related local setup notes as e867a55. The campaign creation work follows that commit and remains uncommitted; nothing was pushed.

Chose a conversational setup instead of a fixed multi-step questionnaire. The existing create-campaign skill already gathers campaign preferences, permits player choices and creates event-backed state. The missing desktop behavior was starting that conversation and providing a suitable view. A lower-cost subagent implemented and reviewed the bounded host setup path; the primary agent integrated and reviewed the UI, transport, documentation and acceptance checks.

## Completed implementation

- src/desktop/host.ts adds beginSetup, scoped to the current campaign and connection generation. It submits the deterministic desktop-campaign-setup request through ordinary typed table transactions only when reviewMode is setup and no table history exists. Concurrent calls share the appropriate promise; an obsolete campaign's promise cannot suppress or clear the new campaign's setup. Lost acknowledgements, interrupted turns and reopening never trigger automatic replay.
- Setup-only DM instructions reuse the initialized campaign, saved name/edition and existing answers. They ask one or two focused questions at a time, accept specific/vague premises or surprise requests, offer user-created or generated characters, save decisions through campaign tools, and verify party/objective/scene/rendered map before enabling reviewed play. Provider adapters and the plugin skill remain unchanged.
- src/desktop/contracts.ts, desktop/main.mts and desktop/preload.cts expose a no-argument validated beginSetup command. desktop/app.ts invokes it only after a successful provider connection. A failed connection preserves the initialized campaign for reconnect.
- desktop/index.html, desktop/app.ts and desktop/theme.css provide a focused creation conversation with explanation, a suitable composer and progress derived from saved party/map/opening state. Empty party/map panes are hidden during setup. Reopening restores the setup view; reviewed mode restores normal play. LAN hosting is disabled in the UI and rejected by the host while setup is active.
- Added offline lifecycle/race tests, expanded the real Electron smoke for the minimum-size creation layout, saved progress, reopening and reviewed transition, and added opt-in test/integration/setup.mjs with npm run test:setup. Updated README.md, docs/desktop.md, docs/architecture.md and docs/verification.md.
- Restarted the ordinary app with the new code and confirmed its campaign screen is available. No personal campaign was created or changed as part of this work.

## Verification actually completed

- TMPDIR=/private/tmp npm test: 112/112 passed after the final host/race changes.
- npm run typecheck: passed.
- TMPDIR=/private/tmp npm run test:desktop: passed the real Electron smoke, including setup at 1000x720, saved party/map progress without early layout transition, reopening unfinished setup and switching to play. Inspected the creation screenshot.
- TMPDIR=/private/tmp DM_CHROME=<installed macOS Chrome executable> npm run test:lan: passed phone/desktop scenarios.
- TMPDIR=/private/tmp npm run test:journal: passed with isolated private IPC/log directories; the user's shared journal daemon was not stopped or reconfigured.
- TMPDIR=/private/tmp npm run test:setup: passed a live Codex CLI scenario in about 264 seconds. The DM published two introductory questions, accepted a deliberately vague delegated request, generated two characters with inventory and a starting map, saved the objective/opening/records, rendered the map, enabled reviewed play and published the briefing. Reconnecting a fresh host preserved revision 20, party and transcript without repeating setup. Artwork was explicitly skipped. The temporary campaign and owned journal runtime were cleaned up; provider conversation history may remain.
- npm run format:check, git diff --check and npm run package:plugin: passed before this final journal entry. A final format/package refresh includes this entry.

The subagent's initial full test run without the canonical macOS TMPDIR hit the previously documented /var versus /private/var path assertions; the primary's final canonical-path run passed all tests.

## Limitations and next steps

Campaign readiness follows the same DM-guided verification and configure_review transition as the plugin; this does not add a complete character/rules engine or server proof that an opening is narratively complete. Codex received live guided-setup acceptance coverage; Antigravity and experimental Ollama share the new host/UI path but were not rerun against real models for this feature. Existing local-model reliability limitations still apply. The live setup skipped artwork; existing artwork tests remain available separately.

Review the uncommitted campaign-flow changes on codex/electron-campaign-setup and commit them separately when requested. The earlier dropdown changes are already committed as e867a55. No push, PR or deployment was requested or performed.
