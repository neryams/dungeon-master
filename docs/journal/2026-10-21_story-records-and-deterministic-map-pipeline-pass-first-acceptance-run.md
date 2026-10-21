# Story records and deterministic map pipeline pass first acceptance run

## Context and decisions

The implementation keeps schemaVersion 1 and optional additions. New typed story changes persist focus, party roster, quests, interactions and explicit pressure triggers. New set_positions removes only listed entities from other maps at the same regional/tactical level; legacy move_token replay is unchanged. Map tools replay the committed event revision before rendering, including duplicate requests after subsequent moves.

## Completed changes

src/schema.ts and src/domain.ts define validation and reducers. src/maps.ts renders SVG internally and PNG through direct Sharp dependency, with independently filtered party data and explicit cell masks. src/service.ts and src/server.ts expose five domain tools and image/png content blocks plus structured metadata. Skills describe staged openings, pacing, and optional host generation. examples/lantern-ford.json now includes objective, leads, NPC progress and bridge map fixtures.

## Verification actually run

npm ci and npm run journal:setup completed. Typecheck passed after tool integration. npm test passed all 25 tests, including original 20 and five new map/story acceptance cases. New tests cover a fresh stdio process, actual MCP image result, exact retry revision, invalid/stale operations, renderer failure recovery, same-level subgroup transfer, filtered SVG/pixel equivalence, explicit pressure trigger, and export/import PNG equality.

## Limitations and next steps

Still finishing CLI demonstration, docs, extra legacy/path cases and visual inspection. Isolated journal integration and final package build have not yet run. Host-generated artwork itself has not been generated; the workflow is optional and has no API integration. Changes remain local and uncommitted.
