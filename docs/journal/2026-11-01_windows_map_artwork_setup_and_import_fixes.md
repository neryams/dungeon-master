# Windows Map Artwork Generation During Setup and Import Path Normalization

## Context

After packaging the Windows x64 release, the user reported that map images were not generating in either `npm run desktop` or the packaged build (`release/`). Inspection of the two live campaign sessions created on this machine (`wood-elves-of-westerwood` and `the-king-s-dinner`) and their corresponding Antigravity CLI transcripts (`~/.gemini/antigravity-cli/brain/c5669fae-bfd6-4fee-9e6d-6b4fe0420c86` and `92458a76-4c02-4572-995b-e6f0508f6f68`, running `agy.exe` `1.4.12` with `gemini-3.8-flash-medium`) revealed the exact root cause.

Project journal MCP tools were unavailable in this session; per `AGENTS.md`, this dated Markdown entry was written directly to `docs/journal/`.

## Investigation and Root Cause

1. **Native Image Generation Works End-to-End When Invoked**:
   - An isolated live reproduction against `agy.exe` (`gemini-3.8-flash-medium`) verified that `render_location_map(mode="reference")` -> `invoke_subagent(TypeName="image-generator")` -> `import_generated_map_art` -> `register_map_art` -> `renderMapImage` succeeds on Windows and produces the composite map image.
2. **Why `gemini-3.8-flash-medium` Skipped `create-map-art` During Campaign Setup**:
   - In both `wood-elves-of-westerwood` and `the-king-s-dinner`, the model never called `render_location_map(mode="reference")`, `image-generator`, `import_generated_map_art`, or `register_map_art`. Instead, it called `create_location_map` and `render_location_map(mode="map")` (schematic), then immediately transitioned `configure_review(mode="reviewed")` and published the opening message.
   - Two prompt/skill cues caused the model to treat `create-map-art` as unnecessary during setup:
     1. `skills/create-campaign/SKILL.md` buried `create-map-art` at the end of Step 6 (the `record_scene` briefing step) with the phrase `"this is optional"`, while Step 5 (the `create_location_map` step) and the closing verification checklist omitted it.
     2. `src/desktop/host.ts` (`setupGuidance`) instructed: `"Before entering reviewed play, verify the party roster, opening scene, actionable objective and readable rendered starting map; then call configure_review(mode=reviewed) with a clear reason"`, without mentioning the illustrated starting map background (`create-map-art`).
3. **Additional Path Normalization and Workspace Sandbox Hardening**:
   - In `src/desktop/art.ts`, `importGeneratedArt` previously required `sourcePath` to be a platform-native path string. If an agent passed a `file://` URI (as emitted in Antigravity `media` / `logAbsoluteUri` outputs) or forward-slash Windows path (`C:/Users/...`), path comparisons could fail before `safePath`.
   - In `src/desktop/server.ts`, `render_location_map(mode="reference")` always wrote `referencePath` under `.dm/hotseat/workspace/map-references/`, even when `DM_DESKTOP_PROVIDER === 'codex'` (which uses `.dm/hotseat/codex-workspace` as its read-only sandbox root).

## Completed Changes

- `skills/create-campaign/SKILL.md`: Moved starting-map background generation (`create-map-art`: `render_location_map` with `mode=reference`, native image generation, `import_generated_map_art`, and `register_map_art`) directly into Step 5 alongside `create_location_map` and included it in the pre-`configure_review(mode=reviewed)` verification checklist whenever host image generation is available and the user has not opted out, falling back to the schematic only if the user opted out or generation fails/is unavailable.
- `src/desktop/host.ts`: Updated `setupGuidance` so the pre-`configure_review(mode=reviewed)` verification explicitly includes generating and registering the starting map's illustrated background via `create-map-art` unless the player opted out or native image generation is unavailable.
- `src/desktop/art.ts`: Normalized `file://` URIs and forward-slash/unnormalized absolute paths via `fileURLToPath` and `path.resolve` in `importGeneratedArt` while preserving strict conversation/manifest containment checks.
- `src/desktop/server.ts`: Directed `referencePath` output to `.dm/hotseat/codex-workspace/map-references` when `DM_DESKTOP_PROVIDER === 'codex'` and `.dm/hotseat/workspace/map-references` otherwise.
- `test/hotseat.test.mjs`, `test/hotseat-setup.test.mjs`: Added unit test assertions for forward-slash and `file://` URI imports in `importGeneratedArt` and `create-map-art` setup guidance.

## Verification Run

- `npm run format:check`
- `npm run typecheck`
- `npm test` (199/199 tests passed)
- `npm run test:journal` (1/1 isolated journal daemon integration test passed)
- `npm run desktop:dist` & `npm run desktop:smoke -- --launch` (rebuilt `release/win-unpacked/`, `release/Dungeon Master-0.6.0-x64.exe`, and `release/Dungeon Master-0.6.0-x64.zip` with the updated skills and desktop runtime)

## Known Limitations and Next Steps

- Existing campaigns that have already transitioned from `reviewMode: "setup"` to `reviewMode: "reviewed"` (`wood-elves-of-westerwood` and `the-king-s-dinner`) will not re-run setup automatically; to add map artwork to an existing location in those campaigns, the player can ask the DM in chat to generate and register an illustrated map background for the current map, or create a new campaign to have it generated during setup.
