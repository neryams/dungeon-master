# Local macOS main update and Electron setup verified

## Context and decisions

The user requested the latest main and local Electron app setup. The checkout was clean on main at dc15524. Fetched origin and fast-forwarded to 0fe3bf9, including the merged standalone desktop, LAN, TypeScript, Codex, and experimental Ollama changes. Read README.md, docs/architecture.md, docs/desktop.md, and relevant historical setup notes. A lower-cost read-only subagent reviewed prerequisites and setup pitfalls.

## Completed setup

- Installed locked dependencies with npm ci (zero reported audit vulnerabilities) and regenerated the ignored development MCP configuration with npm run journal:setup.
- Confirmed Node 24.11.1 and npm 11.6.2 satisfy the documented prerequisites.
- Verified the app detects both installed provider CLIs. Codex reports 0.162.0-alpha.17.2; Antigravity reports 1.4.5. The Codex CLI reports an existing ChatGPT login without exposing credentials.
- Launched npm run desktop and inspected its actual macOS setup window. Selected Codex CLI through the UI and confirmed the detected version appears. Left the normal application running at campaign setup.
- No campaign was opened or created, no provider inference turn was run, and no source behavior was changed. No commit or push was made.

## Verification actually run

- TMPDIR=/private/tmp npm test: 108 tests passed.
- npm run typecheck: passed.
- TMPDIR=/private/tmp npm run test:journal: passed with the isolated temporary daemon fixture; the user's existing daemon was not stopped or reconfigured.
- TMPDIR=/private/tmp npm run test:desktop: passed, covering real Electron setup, exact sheets/maps, provider controls, renderer isolation, seat switching, safe narration, and restart recovery. Inspected the setup screenshot and the normal app's accessibility state.
- npm run desktop: successfully built and opened the ordinary macOS application window.

## Limitations and next steps

This is the documented source-launched app; there is no signed installer or bundled Node. Real provider campaign connection, live narration, artwork generation, and LAN device access were not exercised in this setup. The installed Codex alpha is detected but its full live app-server compatibility has not been certified here. The next user step is to create a campaign or choose an existing folder outside this repository, then connect the provider. Relaunch from this checkout with npm run desktop.
