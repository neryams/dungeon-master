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
