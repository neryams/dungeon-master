# Published story-map increment and proposed player lookup views

## Context and completed publication

At the user's explicit request, committed the implementation as ead84b9c618943605c3597f64f22db1f91700be7 and pushed feature/game-setup to origin. Verified the remote branch points to that commit. The prior milestone records the 29 passing tests, typecheck, isolated journal integration, visual inspection and packaging. No merge to main or PR creation was requested.

## Current lookup capabilities

get_campaign_entity reads exact character, item or map state by ID. resume_campaign gathers relevant party, owned items, scene, active quests and maps, but its entities collection is capped at 100 and is not a complete inventory-list API. render_location_map returns current or explicit-revision PNG pixels and positions. campaign_status exposes revision and journal health. search_campaign_history and read_campaign_record support historical context, never authoritative current HP or inventory.

## Proposed next increment — not implemented

Add get_character_sheet to aggregate one character's HP, resources, conditions, all owned items and regional/tactical placements from one authoritative state read. Add a compact get_party_overview and a filtered/paginated entity listing for browsing known NPCs, locations and items. Expose these initially through conversational requests and a player-sheet skill. A persistent read-only local panel is a later presentation option, not an existing capability.

## Freshness and visibility

Derive views from event-backed state after saved mutations; avoid maintaining a second manually edited record. Return the source revision, refresh on opening/request, and refresh any persistent panel after successful mutations or when its revision check changes. A displayed chat response or PNG is a snapshot and does not update itself. Use party filtering for player-facing views. Independent player access would require a separate authorization boundary; audience filtering currently serves one trusted operator.

## Verification and next steps

Publication verified with git ls-remote. No runtime behavior changed in this follow-up. User has asked for advice on lookup exposure, not implementation of the proposed new tools. Discuss the preferred presentation before starting another feature increment.
