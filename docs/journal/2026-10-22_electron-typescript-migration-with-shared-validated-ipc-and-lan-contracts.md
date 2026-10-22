# Electron TypeScript migration with shared validated IPC and LAN contracts

## Context and decisions

Converted the Electron pieces on `feature/lan-multiplayer`, based on commit `506fe7f`, to strict TypeScript. The goal is stronger shared interfaces without changing the campaign format, desktop security model, CLI architecture, or ChatGPT plugin path.

## Implemented changes

- Migrated desktop main/preload to `.mts`/`.cts` and desktop/LAN browser renderers to `.ts`. Separate referenced compiler projects preserve Node and browser boundaries and emit deployable assets under `build/desktop`.
- Added `src/desktop/contracts.ts` with shared snapshots, API request/response types, runtime argument schemas and explicit validated dispatch. Worker messages begin as unknown; removed broad untyped function dispatch.
- Added typed DOM helpers and browser bridge declarations. Tightened character/item/quest projections and nullable campaign/map handling. Character creation validates the selected rules edition.
- Updated launcher, LAN asset serving, packaging and Electron UI tests to use compiled assets. Added bridge contract tests for argument arity, malformed requests, admin actions and optional wire arguments.
- Retained JSON worker IPC. An attempted advanced serialization transport failed between Electron and external Node with an unsupported V8 serialization version; optional JSON array arguments now explicitly normalize null to undefined instead.
- Preserved sandboxing, context isolation, external Node worker execution, event store mutation rules and plugin behavior. No model API integration or campaign data migration.

## Verification

Passed `npm test` (75 tests), `npm run typecheck`, `npm run test:desktop`, `npm run test:lan`, `npm run test:journal`, `npm run package:plugin`, `npm run format:check` and `git diff --check`. Journal integration ran in isolated temporary workspaces without modifying the user's daemon. After the final edition validation cleanup, rebuilt and reran the compiled Electron UI test successfully.

## Limitations and next steps

No live Antigravity inference was rerun for this type migration; automated host, protocol, LAN and compiled desktop integration tests passed. Changes remain uncommitted for review; no push was requested. Startup remains `npm run desktop`. Packaging and formatting will be refreshed after adding this entry.
