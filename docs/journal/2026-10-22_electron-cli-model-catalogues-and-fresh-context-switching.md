# Electron CLI model catalogues and fresh-context switching

## Context and decision

The host could select Codex, Antigravity or local Ollama but hosted model selection remained in external CLI configuration. The user requested a CLI-reported model picker and a way to switch models during an existing campaign, with a warning about context/cache loss. Implemented on branch `codex/electron-campaign-setup` after the user-authorized Markdown commit `4d4fbde`. These model-selection changes are uncommitted; no push or new commit was requested for them.

Use installed CLI metadata rather than a hardcoded product/model list. Antigravity exposes TSV through `agy models`; Codex exposes paginated `model/list` through an app-owned short-lived app-server. Installed CLI discovery succeeded for both providers without starting inference. Codex protocol reference: https://learn.chatgpt.com/docs/app-server. Explicit model choices use the model's reported default reasoning effort, avoiding incompatible inherited effort. CLI-default selection continues to defer to the CLI.

## Implemented changes

- `src/desktop/models.ts`: bounded catalogue parsing, pagination, safe display text/IDs, timeouts and owned-process termination. Discovery starts no thread/turn and never invokes a direct model API.
- `src/desktop/codex.ts` and `src/desktop/antigravity.ts`: pass explicit model selection to the CLI. Codex rejects a selected model missing from its fresh catalogue before thread start/resume.
- `src/desktop/contracts.ts`, `desktop/main.mts` and `desktop/preload.cts`: typed validated catalogue/select/switch bridge and separate hosted-provider preferences. Main validates saved explicit selections on reconnect and guards provider/model changes while awaiting metadata. Failed switches retain the attempted selection for retry.
- `src/desktop/host.ts`: bind optional provider context locators to model identity, discard mismatched locators, preserve old default and local locator compatibility, reject busy switches before locator changes. Provider/model status stays desktop-only; player LAN projections are unchanged.
- `desktop/app.ts`, `desktop/index.html` and `desktop/app.css`: provider-screen Model selector/Refresh, idle table header DM model dialog and recovery control. Switching explicitly starts fresh conversation context. Cancel is inert before applying, and Cancel/Escape cannot imply cancellation once the connection has started. Campaign events, public history, characters, maps and LAN seats remain intact; no uncertain action is replayed.
- Documentation in README, docs/desktop.md, docs/architecture.md and docs/verification.md describes availability, default selection, context loss and retry semantics.

## Verification actually run

- `TMPDIR=/private/tmp npm test`: 126/126 pass; `npm run typecheck` passes.
- `TMPDIR=/private/tmp npm run test:journal`: real pinned isolated journal integration passes, with private IPC/logs and deliberate keyword fallback. No existing daemon stopped or reconfigured.
- Electron smoke passed through the real preload/main/worker bridge with a synthetic executable Codex CLI: model discovery, remembered per-provider selection, cancellation, fresh model/thread switch and unchanged revision/transcript/HP. The ready dialog also fits the supported 1000x720 minimum window with a long model label. Screenshot inspected at a temporary UI artifact path. This fixture only allows connection-check prompts and performs no inference.
- `TMPDIR=/private/tmp DM_CHROME='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' npm run test:lan` passes. The initial run's Linux-default Chrome path was absent on macOS; rerunning with the installed browser resolved the environment issue.
- Formatting and plugin packaging passed before final review hardening; final checks will cover the completed increment.

## Limitations and next steps

Provider conversation context is reset, but provider-side cached tokens are outside the app's control and may need rebuilding. Catalogue availability does not certify every model's account entitlement, tool/image capability or D&D quality. No new live hosted storytelling/gameplay turn was run for this increment; actual model arguments, lifecycle and UI are covered by deterministic fixtures plus real read-only CLI metadata. The running personal campaign was not stopped or changed. Restart the Electron app when convenient to load the built changes. Review and commit this increment only when requested.
