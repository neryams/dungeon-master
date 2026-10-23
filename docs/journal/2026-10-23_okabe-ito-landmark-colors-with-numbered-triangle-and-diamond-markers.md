# Okabe Ito landmark colors with numbered triangle and diamond markers

## Context and decisions

The user found that landmark triangles were visually indistinguishable and requested the Okabe–Ito eight-color palette, with diamonds for objects 9–16. This extends the pending semantic-marker and desktop-key work after `5bbfd0d`; it does not commit that work.

Verified the palette and redundant-encoding guidance against the authors' primary reference, https://jfly.uni-koeln.de/color/ (palette image https://jfly.uni-koeln.de/color/image/pallete.jpg). Objects and landmark features share one allocation pool on each already audience-filtered map. Slots 1–8 use triangles, 9–16 diamonds; color/shape pairs repeat every 16. Numeric labels remain unique beyond that and match the map key, so color alone is not required. Black or white text is selected by relative luminance contrast, with white marker outlines to retain visibility on dark artwork.

## Completed changes

- `src/map-markers.ts`: exact eight-color palette, joint feature/entity allocation using scoped stable IDs (feature and entity IDs may overlap), numeric labels, diamond metadata and contrast text. Assignments are computed before viewport cropping from the visible set, preventing hidden entries from affecting player colors or labels.
- `src/maps.ts`: renders the shared numbered symbols on illustrated and schematic maps, uses the same metadata for object tokens and landmark features, and includes numeric references in document legends. Character/NPC initials and outlines and clean artwork-reference images are preserved. Parent review corrected small illustrated-marker sizing, text contrast and removed broad renderer type casts.
- `desktop/markers.ts`, `desktop/app.ts`, `desktop/index.html`: matching colored/numbered SVG triangles and diamonds, updated key explanation, accessible per-entry identification.
- `docs/desktop.md` and `docs/architecture.md`: describe allocation, overflow and visibility behavior.
- `test/maps.test.mjs`: eight distinct palette colors, shape boundaries, overflow numbering, shared entity/feature IDs, viewport invariance, rasterization and reference behavior.
- `test/desktop-ui.mjs`: isolated 17-landmark fixture, exact projected-vs-DOM color/shape/number/text checks, hidden-key exclusion and pan invariance; retains existing smaller-window and recovery coverage.

## Verification actually run

- `TMPDIR=/private/tmp npm test`: 130/130 pass after final renderer refinements.
- `npm run typecheck`: pass.
- `npm run test:desktop`: real Electron test passes. Parent visually inspected its screenshot with all 17 numbered landmarks, including triangles, diamonds and readable contrast.
- `TMPDIR=/private/tmp DM_CHROME='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' npm run test:lan`: 1/1 pass.
- `TMPDIR=/private/tmp npm run test:journal`: 1/1 pass using isolated journal IPC/logs. No user daemon stopped or reconfigured.
- `npm run format:check` and `git diff --check`: pass before writing this entry.

## Limitations and next steps

Assignments remain stable across viewport changes and identical visible snapshots. Adding, removing or revealing objects can reassign derived numbers/colors because the visible set determines allocation. No campaign events, credentials, live campaign records or model inference were changed or used. The existing Electron game was not restarted. These marker/key changes remain uncommitted; reload Electron when convenient and commit only at the user's request.
