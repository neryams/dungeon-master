# Codex Electron adapter verified with native artwork LAN play and preserved providers

## Context and decisions

Implemented the requested Codex provider on `feat/codex-electron-adapter`, based on fetched `origin/main` at `0d6e281` (merged LAN/TypeScript work). No commit or push was made. The installed Codex CLI 0.162.1 uses its existing ChatGPT authentication; the app does not read/copy authentication tokens or call a model API.

## Completed changes

- `src/desktop/codex.ts` implements local app-server initialization, account checks, configuration overrides, thread start/resume, turn correlation, exact campaign readiness from MCP results, bounded streams, timeout/process/error handling, and owned-process shutdown. It ignores foreign/stale events and raw private assistant output. Unsupported interactive requests fail with attention rather than granting permissions. Native bounded referee delegation is allowed with the primary model inherited; unavailable delegation retains the existing explicit fallback.
- `src/desktop/host.ts`, `contracts.ts`, and `desktop/` add a validated provider selector, remembered executable paths, separate workspaces/session locators, and durable selected-provider context reset. Existing Antigravity preferences/session files remain compatible. Codex disables unrelated configured MCP servers/plugins and shell/web tools in its own thread only, retaining the ordinary plugin configuration. The desktop IPC connection timeout now accommodates the existing ten-minute provider timeout.
- The same owner-checked desktop MCP server exposes every normal campaign tool to both providers. `src/desktop/art.ts` additionally permits Codex image paths only after successful native image-generation completion for the active thread/turn, through an owner-bound allowlist. Image writes are awaited before turn completion. Import validates path/image bounds and rejects symlinks; registration still goes through the existing campaign transaction.
- Added offline Codex protocol/ownership/provider-context tests and `npm run test:codex`, sharing the existing real-provider scenario with Antigravity. Updated README, architecture, desktop setup/parity notes, and verification documentation. Ordinary campaign service/reducers and plugin stdio entry points were not changed.

## Verification actually run

- `npm ci` and `npm run journal:setup` succeeded.
- Final `npm test`: 89 passing; `npm run typecheck` passed. Coverage includes auth rejection, RPC failure without replacement threads, partial events, stale/foreign tool results, raw-output filtering, concurrency, timeout/exit/invalid output, unsupported requests, provider switching and context reset, plugin configuration preservation, exact generated-image allowlists, and artifact-write failures.
- `npm run test:journal` passed with the existing isolated private IPC/log fixture and keyword fallback. No user shared daemon was stopped or reconfigured.
- `npm run test:desktop` passed twice, including the real Codex selector/IPC, renderer sandbox, maps/sheets, public output, seats and restart. Setup screenshots were inspected. `npm run test:lan` passed phone/desktop browser scenarios.
- Authenticated `npm run test:codex` passed twice. The final run completed in about 185 seconds at revision 28. Authenticated `npm run test:antigravity` passed in about 218 seconds at revision 27. Both exercised five public turns: exact damage/movement, duplicate submission suppression, LAN group intentions, targeted question/reply, Send now with native image generation, bounded import and registration, identical desktop/LAN composite rendering, fresh-process resume and retained mechanics. The Codex composite was visually inspected. Fixtures lived in temporary directories outside the source tree; the Antigravity permission grant was restored by the existing test cleanup.
- `npm run format:check`, `git diff --check`, and `npm run package:plugin` passed before this note. A final package/format refresh follows to include the journal entry.

## Known limitations and concrete next steps

The live scenarios use explicitly supplied legacy mechanical outcomes; they do not certify a full reviewed adventure, independent referee correctness, or all D&D rules. Native bounded referee delegation is allowed but a dedicated live reviewed-play acceptance run remains useful. Other operating systems, signed installers/updates, bundled Node, individual player accounts, click-to-move and streamed public prose remain outside this change. Codex interactive approval UI is not implemented. Generated Codex files not yet imported must come from the current connection's observed output; reconnect resets that allowlist. Already registered campaign assets persist normally.

Next steps: review the uncommitted branch, run an actual reviewed campaign-opening/play session, and broaden platform packaging and native referee acceptance coverage. Launch with `npm run desktop` and select Codex CLI on the connection screen. No deployment, commit or push is automatic.
