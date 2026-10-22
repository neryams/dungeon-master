# Codex Electron adapter branch aligned with merged LAN baseline

## Context and decisions

User requested a new branch enabling Codex in the Electron app while preserving the plugin and approaching Antigravity parity. Created `feat/codex-electron-adapter` from the initial clean checkout. Located Electron/LAN work at `7eb589a`; after the user pointed out new upstream pushes, fetched and fast-forwarded to `origin/main` at `0d6e281`. Its tree matches that baseline. No commit or push performed.

## Implemented work in progress

Added a local Codex app-server driver in `src/desktop/codex.ts`, provider selection through validated desktop IPC, separate provider workspaces/session locators, and a Codex-generated image import allowlist. The existing campaign MCP service remains the common implementation; no direct model API calls or authentication-token handling were added. Codex CLI 0.162.1 reports ChatGPT authentication. Runtime configuration overrides disable unrelated tools only in the app-owned thread; global plugin settings remain unchanged.

## Verification actually run

Read README and architecture; searched/read the development journal. Ran npm ci and npm run journal:setup. Generated protocol schemas from the installed CLI and consulted the official app-server documentation. First offline npm test passed 83 tests and typecheck passed. Live Codex integration initially exposed quoted-key and null-field incompatibilities in config overrides before gameplay. Those are being corrected; live parity is not yet verified.

## Limitations and next steps

Finish authenticated connection, mechanics/publication, LAN grouped/targeted input, artwork, and fresh-process resume checks. Add failure-path and artifact-boundary coverage, run isolated journal integration, Electron/browser smoke tests and plugin packaging, then document precise remaining parity gaps. All campaign fixtures are temporary and outside the repository. Existing shared journal daemon remains untouched.
