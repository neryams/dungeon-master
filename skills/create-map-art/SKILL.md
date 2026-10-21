---
name: create-map-art
description: Create optional campaign map artwork, location illustrations or portraits with the host's built-in image generation and register the chosen campaign-local asset.
---

Read campaign_status, get_campaign_entity for the saved map and relevant locations/characters, and relevant saved descriptions. Choose the intended audience before building a prompt. For player artwork, use only audience=party context and revealed locations; do not send private source material into the player illustration. Read render_location_map's saved revision and optionally use its PNG as a reference.

Use the host's built-in image-generation tool when available, following its input and file handling instructions. Keep evocative landscape, architecture and portrait detail in the artwork. Coordinates, labels, character markers and precise geometry belong in the deterministic renderer. Do not imply a painting aligns to tactical cells. Show the artwork separately from the grid.

If host generation is unavailable, continue with the schematic and explain that limitation. Never substitute a paid API or add model calls to the plugin.

Save the chosen generated output under the bound campaign's assets/ directory, using available host file tools and a unique filename. If the tool returns only a conversation image and no downloadable local artifact, explain that registration requires a saved file; do not invent a path or claim it was saved. Do not place campaign artwork in the plugin source repository. Copying an image into assets is file handling; register its metadata with register_map_art using a fresh operationId, current expectedRevision, mapId and art {path, purpose, sourceRevision, visibility}. sourceRevision is the saved map revision used for the prompt, even if generation took time. Preserve exact input and operationId on retry.

Verify the registration with get_campaign_entity. Original assets participate in export/import; derived schematic PNGs can be regenerated. Do not use full-map artwork as a player grid background, even if only a portion is explored.
