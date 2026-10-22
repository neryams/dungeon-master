# Electron UI refined around compact controls and an olive brass map workspace

## Context and decisions

The user requested committing all existing work, then refining the desktop UI using their supplied mockup: remove extraneous welcome slogans and focus on actionable controls with more visual character. Committed the previously verified Electron/Antigravity illustrated-map MVP as f382702 before beginning this refinement. Used the mockup's compact sidebar, dominant map, olive panels and brass accents as inspiration. No generated decorative assets or new model calls were required.

## Completed changes

- desktop/index.html and desktop/theme.css: replaced the marketing welcome section with compact connection/open/new-campaign controls; removed oversized slogans and redundant labels. Added olive/brass surfaces, compact party cards with initials, ability tiles, a smaller toolbar, focused chat composer and an expanded map area. Connection details and scene summaries use accessible disclosures. Focus outlines, reduced motion and recovery messages remain available.
- desktop/app.js: shorter action labels and status text, real seat-selection state, Fit map/Auto viewport sizing, Legend toggle and appropriate disabled controls. Map bounds are capped at the existing 40-cell viewport limit; unbounded maps use the existing 20-cell fallback. Updated docs/desktop.md to match visible controls.
- src/maps.ts and src/desktop/host.ts: optional desktop canvas framing crops only the already audience-filtered composite to its map extent, with 2x raster density for the larger display. The Legend toggle restores the full document image. Default MCP and web-panel framing, campaign state, image generation and the ChatGPT plugin route are preserved.
- test/desktop-ui.mjs: exercised canvas/document parity, legend toggle, pan and fit, scene disclosure, visible artwork fallback warnings, seat switching, restart, standard plugin setup and layout/composer visibility at 1000x720.

## Verification actually run

- npm test: 71/71 passed after final renderer changes.
- npm run typecheck: passed.
- npm run test:desktop: passed after final renderer changes; visual inspection also used synthetic registered artwork from the earlier Antigravity smoke, with all fixtures and screenshots outside this repository. Inspected setup, normal and minimum-size layouts.
- npm run test:journal: passed during this refinement in its isolated temporary workspace; the existing shared daemon was not stopped or reconfigured.
- npm run package:plugin: passed after final source changes.
- npm run format:check and git diff --check passed during the refinement; final journal formatting and diff verification precede the UI commit.

## Limitations and next steps

The Antigravity prompt/transport/generation workflow is unchanged, so no additional paid CLI conversation was run for this styling pass. The earlier live generation verification remains documented separately. No decorative nonfunctional dice or drawing controls from the mockup were introduced. The UI refinement is being committed separately from f382702; no push is requested. Restart npm run desktop to load the revised UI.
