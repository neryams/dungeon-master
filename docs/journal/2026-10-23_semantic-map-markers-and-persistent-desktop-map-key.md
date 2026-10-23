# Semantic map markers and persistent desktop map key

## Context and decisions

The model catalogue and model switching feature was committed at the user's request as `5bbfd0d` on `codex/electron-campaign-setup`. The next request was to restore the map legend and visually connect party-card badges to map markers. The previous desktop legend was available through document framing, but that control was easy to miss. Marker shapes previously came from ID hashes, so they conveyed no entity meaning.

## Completed changes

- `src/map-markers.ts` provides deterministic name-derived initials, stable ID-based colors, semantic circles for characters, dotted circles for NPCs and triangles for objects. It also projects map-key entries from an already audience-filtered state, including readable graph-node positions and revealed features.
- `src/maps.ts` uses the same appearance for all map outputs, preserves stacked placements and active-turn rings, and renders landmark features as triangles. Clean reference images retain their original feature boxes.
- `src/player-view.ts` adds matching party-badge metadata and filtered per-map legend entries; it does not change events or campaign state.
- `desktop/markers.ts`, `desktop/app.ts`, `desktop/index.html`, `desktop/theme.css` and `tsconfig.ui.json` add matching SVG party badges and a persistent Map key below the party cards. NPC/object/feature names and positions follow the selected map. Party members are represented by their cards rather than duplicated in the list. The key includes revealed placements outside the viewport, scrolls for long lists and preserves its scroll between identical polls. The previous document-framing control is now labelled Details.
- `docs/desktop.md` and `docs/architecture.md` describe the UI and filtered metadata boundary.
- `test/maps.test.mjs` covers semantic appearance, stable name/color matching, hidden/fogged legend exclusion, NPC rasterization and reference compatibility; `test/desktop-ui.mjs` checks visible current-map labels, positions and party badges against snapshot metadata.

## Verification actually run

- `TMPDIR=/private/tmp npm test`: 129/129 pass.
- `npm run typecheck`: pass.
- `npm run test:desktop`: real Electron UI pass using isolated synthetic campaigns and fake CLI metadata. Parent visually inspected the table screenshot showing the party circles and persistent key; minimum-window coverage also passes.
- `TMPDIR=/private/tmp DM_CHROME='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' npm run test:lan`: 1/1 pass.
- `TMPDIR=/private/tmp npm run test:journal`: 1/1 pass with isolated journal runtime; no existing daemon stopped or reconfigured.
- `npm run format:check` and `git diff --check`: pass before this journal entry.

## Limitations and next steps

No live campaign data was used or modified. The user's existing Electron game was not restarted. The marker/key changes remain uncommitted for review; restart the desktop when convenient to load them. Map badges remain visual identifiers rather than drag/click movement controls. Provider/model commit is complete; no source push was requested.
