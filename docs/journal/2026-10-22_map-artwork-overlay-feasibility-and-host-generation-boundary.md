# Map artwork overlay feasibility and host generation boundary

## Context

The user asked whether location setup can use host image generation with the existing schematic PNG to create attractive artwork beneath live map locations or grid positions. This was a feasibility discussion, not an implementation request.

## Findings and rationale

Inspected README.md, docs/architecture.md, skills/create-map-art/SKILL.md, src/maps.ts, src/schema.ts and map-related tool documentation. The existing skill already instructs the host agent to use built-in image generation, optionally referencing the schematic, and register a local campaign asset through register_map_art. It explicitly keeps art separate from tactical geometry. MapArt currently stores path, purpose, sourceRevision and visibility, with no map-to-image alignment metadata. The renderer draws schematic PNGs without compositing registered art.

The proposed extension is feasible as a host-agent skill workflow, without adding model API calls to the MCP server. The current conversation exposes a host image-generation tool accepting reference images. Availability and local output handling still need testing in the actual campaign session.

Recommended design: create a clean reference image without transient tokens, labels or surrounding legend; generate and save a reusable background; verify landmarks and geometry; register alignment/map extent metadata through typed event-backed changes; composite live markers, labels, grid and reveal masking at render time. Image-generation reference conditioning is not a guarantee of exact geometric preservation. Regional maps are a lower-risk first target than tightly aligned tactical interiors. Never expose original full-map art to players when it contains unrevealed details; compositing/masking needs explicit tests and panel integration.

## Completed work and verification

Read-only code and development-journal investigation completed. Consulted official OpenAI plugin skills documentation on host workflow/tool orchestration. No runtime code or skill edits, image generation, tests, commits or pushes performed. Existing unrelated untracked journal entries were left untouched.

## Next steps

If implementation is requested, extend artwork metadata and renderer/panel composition, update setup and artwork skills, and test alignment, viewports, player masking, retry behavior and export/import. Run npm test and npm run typecheck after behavior changes. Keep all campaign artwork outside this source repository.
