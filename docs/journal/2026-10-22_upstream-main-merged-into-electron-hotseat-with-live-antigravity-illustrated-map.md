# Upstream main merged into Electron hotseat with live Antigravity illustrated map verification

## Context and decisions

The user requested the latest master commits merged into the existing standalone-app branch and verification including map image generation against Antigravity. The remote default is main, with no master branch. Fetched origin and fast-forwarded feature/standalone-app from 6d298ab to dc15524, including illustrated backgrounds (83b96e3). Preserved the pre-existing uncommitted Electron MVP with an include-untracked stash, reapplied it, resolved the src/panel.ts conflict, and returned changes to unstaged status. No commit or push was made; the safety stash remains available.

## Completed changes

- src/panel.ts retains the shared playerView projection and upstream composite renderer, including fallback warning headers.
- src/desktop/host.ts uses renderMapImage for eligible artwork beneath live overlays and caches its warnings; desktop/app.js displays fallback warnings. Includes create-map-art in the DM contract and permits native image generation while retaining campaign-tool-only state mutations and no shell/API fallback.
- src/desktop/server.ts mirrors clean reference PNGs into the dedicated CLI workspace for native conditioning. A desktop-only import_generated_map_art tool invokes src/desktop/art.ts to copy bounded, validated raster output from the connected Antigravity conversation into content-addressed campaign assets. Other conversation paths, traversal, symlinks and non-images are rejected. Registration remains the normal typed register_map_art transaction. The normal ChatGPT/Codex MCP tool set is unchanged; no additional global permission grants are needed.
- Updated hotseat, real Electron UI and authenticated Antigravity tests plus desktop/architecture/verification documentation. The UI test checks composite byte parity and visible fallback warnings after artwork disappears. Offline tests cover actual MCP reference delivery and import errors, asset confinement, retry stability, cache warnings and no render-side campaign events.

## Verification actually run

- npm test: 71/71 passed after final source changes.
- npm run typecheck: passed after final source changes.
- npm run test:journal: passed in its isolated temporary workspace. No existing journal daemon stopped or reconfigured.
- Real Electron UI automation passed: setup, isolation, literal text rendering, party sheets, seat switching, composite parity, fallback warnings, restart and standard ChatGPT/Codex campaign configuration. Screenshot visually inspected.
- Authenticated Antigravity 1.4.4 integration passed in approximately 206 seconds, reaching revision 13 in a synthetic temporary campaign: verified connection; exact damage and movement; public narration; duplicate submission; clean reference; actual native image-generator output; bounded asset import; registered party background; desktop/plugin PNG byte parity; fresh-process resume and second-character recap with damage applied only once. Generated composite was visually inspected. CLI used its built-in image-generator and saved the image in the parent conversation artifact directory. No model API calls or broad permission bypass were added.
- npm run package:plugin and npm run format:check passed before the final minor prompt wording/test refinement; final packaging/format verification is being rerun. git diff review pending final check.

## Limitations and next steps

This is an isolated legacy-campaign acceptance smoke, not a complete new-adventure or independent-referee evaluation. Image generation consumes CLI account usage and can fail under host limits; the documented schematic fallback remains available. No LAN multiplayer, installer, or additional CLI adapter was added. Campaign fixtures and generated art remain outside the source repository; Antigravity retains its own synthetic conversation artifacts. Reconnect an existing desktop session to load the refreshed workspace/server instructions. All implementation changes remain uncommitted for review alongside this journal entry.
