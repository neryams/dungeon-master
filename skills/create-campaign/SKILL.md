---
name: create-campaign
description: Initialize a new D&D campaign workspace and configure the Dungeon Master plugin for local Codex play. Use for campaign creation or initial plugin setup.
---

If campaign tools are already available, call campaign_status first. When the user is setting up the bound campaign, populate that workspace rather than initializing a second one. Create a new workspace only when the user requests a new campaign.

Gather the campaign name, 2014/2024 5e edition, premise, tone, house rules, party and opening situation. Use the user's existing choices; default to 2024 only when no edition was specified. Explain that this version tracks mechanics while the DM adjudicates rules.

For local setup, use the installed `dungeon-master init <slug> --name <name> --edition <edition>` CLI. An optional JSON `--config` accepts premise, tone and houseRules. Default campaign location is ~/Campaigns/<slug>. Use structured file-writing tools for JSON, and shell argument arrays or proper quoting for user-provided strings. Do not insert campaign prose into executable shell code.

If the CLI is unavailable on PATH, inspect ../../mcp.json. A generated campaign plugin names the absolute Node executable and installed dist/server.js path; invoke the sibling dist/cli.js with that same Node executable. For a generic package without an absolute server path, consult ../../README.md installation instructions. Do not manufacture a successful setup. If the host cannot execute local tools, explain that the campaign server must be connected through a supported MCP connection first; a cloud chat alone does not initialize local storage.

Initialization creates an isolated campaign workspace and a bound plugin/marketplace configuration. Open the resulting folder as the campaign's local project using available app tools when authorized. If project management tools are unavailable, give the folder and next action. Start a new conversation if tools are not yet loaded.

Once campaign tools are available, call campaign_status. Confirm it is the intended campaign before writing. Use apply_campaign_changes to create characters, starting inventory, locations, maps, quests, session and scene. Batch related entities so references are valid at the end of the transaction. Keep DM secrets in separate visibility=dm entities or records; campaign configuration, scene summaries and unresolved questions are player-facing.

Call record_scene for the opening situation and resume_campaign to verify setup. Report the campaign folder, saved revision and any pending journal delivery. Do not create a GitHub repository, push data or start external hosting as part of initialization.

Build a playable opening in stages, using the player's answers already available in context:

1. Gather edition, tone, difficulty, boundaries and preferences, desired campaign length, and party details. Give each character a goal, bond, and unresolved problem. Establish why they stay together and why the opening matters to them. Save the public agreement with record_scene and set_party with explicit member IDs.
2. Establish one central conflict: participants, competing wants, and what happens without intervention. Save private motives and future possibilities separately as DM records or plan entities. Define pressures with explicit fictional triggers; conversation length never advances them.
3. Prepare one starting settlement, roughly 4–6 nearby locations and 3–5 essential NPCs. These are defaults, not quotas. Link map rooms/landmarks to location entities. Put essential clues in several discoverable places or interactions.
4. Save an opening quest with set_quest: objective, stakes, progress, leads, completionConditions and status=active. Save set_focus with the primary objective and activeQuestIds. Create NPC interaction records with wants, knows, disclosed, offers, unresolvedTopics and resolvedTopics; undisclosed knowledge is private.
5. Save set_scene with centralQuestion, progress, pendingDecision and exitConditions. Start with an immediate meaningful decision and several approaches, allowing unexpected choices. Use create_location_map for the initial layout and positions; for grids supply explicit bounds and reveal masks.
6. Write a short player briefing with record_scene visibility=party and a separate private DM reference with visibility=dm. Expand later detail as the party approaches it. When the host's built-in image generation is available and the user has not opted out, use the create-map-art skill during starting-location setup to make and register a party-safe illustrated map background; this is optional, and a failed/unavailable generation leaves the schematic playable. Reuse that background afterward. Never use a background to infer or alter saved coordinates or topology.

Finish by calling resume_campaign, get_campaign_entity for the objective/party/map as needed, and render_location_map. Verify a clear objective, actionable pending decision, correct party state and readable initial map. Report saved revision and any rendering/delivery warning. A proposed opening is not saved until tools confirm it.

New CLI campaigns begin with event-backed reviewMode=setup. After the opening state and map are verified, use configure_review(mode=reviewed) with an explicit reason before play. Explain that mechanical actions receive bounded referee review using the primary model; the primary DM can record an administrative override. Existing campaigns without a review policy remain legacy until explicitly enabled. Do not infer movement speeds, spell/feature rules or action budgets from an incomplete character sheet: save supplied details in character descriptions or request them when preparing actions.
