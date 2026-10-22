# Illustrated map backgrounds implemented and host generation verified

## Context and decisions

Implemented the requested illustrated map workflow on branch `codex/illustrated-map-overlays`. The user authorized minor cosmetic differences and image-generation retries. Host image generation remains an agent skill workflow; the campaign MCP server makes no model API calls. Three lower-cost subagents handled the registration contract, workflow documentation, and integration tests; the parent implemented rendering/panel composition, reviewed their work and integrated corrections.

## Completed changes

- `src/schema.ts`, `src/map-art.ts`, `src/service.ts`: optional background extent, SHA-256 image integrity and static geometry fingerprints; bounded image validation; source/current geometry checks within the transaction; unchanged exact-retry semantics. Static geometry fingerprints are independent of locale, markers and reveal state, and retain legacy implicit graph node ordering.
- `src/maps.ts`: clean `render_location_map` reference mode; saved background composition beneath live markers, labels, grids and explicit fog; shared in-memory rendering for the panel; schematic fallback for missing, altered, unreadable or stale art. Reference images have exact viewport bounds and exclude text, transient tokens and existing art.
- Party grid fog stays opaque. Graph backgrounds are withheld while any node or edge is hidden. A concealed feature within the artwork extent also withholds a party background if its grid cell is otherwise visible, or on a graph. Private art never appears in party views. No raw original asset is served by the panel.
- `src/panel.ts`, `src/panel-ui.ts`: use the shared composite renderer without campaign writes and surface cached fallback warnings.
- `skills/create-map-art/SKILL.md`, `skills/create-campaign/SKILL.md`, `skills/run-campaign/SKILL.md`: generation during starting/new-location setup when supported and not opted out; reference guidance, local asset registration, visual inspection, at most three generation attempts, reuse during movement, and schematic fallback. Standalone illustrations/portraits still omit background metadata. Cosmetic differences are acceptable; mechanical/topological changes require explicit typed map updates and refreshed art.
- `README.md`, `docs/tools.md`, `docs/architecture.md`: updated workflow, contracts and limitations.
- `test/map-art-contract.test.mjs`, `test/map-overlays.test.mjs`: registration/retries, geometry invalidation, viewport crop alignment, reference/MCP PNG responses, opaque fog, concealed features, DM-only art, export/import, panel parity and no-write checks, cached fallback warnings.

## Verification actually run

- `TMPDIR=/private/tmp npm test`: 63/63 passed after final source changes.
- `npm run typecheck`: passed after final source changes.
- `TMPDIR=/private/tmp npm run test:journal`: isolated real pinned journal test passed; no existing daemon stopped or reconfigured.
- `npm run package:plugin`: passed; local ignored package rebuilt.
- `npm run format:check`: passed; `git diff --check`: passed during review.
- All three updated skills passed `quick_validate.py` using the available Conda Python. The default Python lacked PyYAML; no packages or global settings were changed.
- Default `npm test` initially hit the previously documented macOS `/var` versus `/private/var` CLI test path assertion. Used the established canonical short TMPDIR setting rather than changing unrelated CLI behavior.
- Actual built-in host image generation used a clean reference PNG from an isolated public sample campaign. One generated woodland background was saved and registered; the composite was visually inspected before/after moving a character to the bridge and applying northeast fog. Artwork, sample data and preview images were kept outside this source repository. No API fallback was used.

## Known limitations and next steps

Reference conditioning does not guarantee exact geometry. Minor bridge/boulder placement drift in the sample was acceptable for the requested cosmetic use. Saved geometry remains authoritative; prompts and bounded retries guide visual quality but are not an automated visual-alignment judge. Graph fog remains conservative because graphs lack a spatial mask. Hidden-feature suppression can intentionally withhold otherwise usable art. Each audience uses its latest registered background, not multiple tiled backgrounds. A single extent is limited to the existing 1–40 cell viewport dimensions. Original bytes must remain at the registered unique campaign-local path to reproduce artwork; altered/missing files fall back to the schematic.

The host-generation/save/register/render steps were verified directly, but automatic skill selection in a fresh campaign chat has not been tested. Existing campaign plugin copies must be refreshed to use the updated skills/runtime. No actual player campaign was changed. No commit, push or PR was made; the branch is ready for review. Unrelated pre-existing journal files were preserved.
