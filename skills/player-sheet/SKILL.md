---
name: player-sheet
description: Answer campaign character-sheet, health, inventory, resources and party-location questions from current saved Dungeon Master state, including requests to show the current map.
---

Use get_character_sheet for a known character ID, or get_party_overview to discover roster IDs and answer party-wide health/location questions. Default to audience=party; request DM data only for an explicit private DM lookup. Do not infer who “my character” is from roster order. Use an established character association from the conversation, the sole visible party member, or ask the user to choose among the returned names when ambiguous. An empty explicit roster means no party members have been recorded.

Fetch a fresh snapshot for each lookup. Do not reconstruct HP, inventory or position from chat memory or historical search. These tools read saved state without advancing time, rolling dice, changing gameplay or contacting the journal. If a lookup fails or a character is not found, report that limitation; do not silently switch to DM audience or invent a sheet. NPC detail remains available through get_campaign_entity when explicitly requested.

Answer the question asked: a health question needs HP/max, temp HP and relevant conditions, not a whole sheet. For a full sheet, give name and saved revision, HP/max/temp, AC, conditions, resources, relevant abilities/saves/skills, inventory quantities/equipped status/charges, and locations. Inventory is complete for the requested audience; zero-quantity entries are depleted, not usable items. Do not infer unrecorded weight, currency conversions, class, level or derived rule bonuses. Summarize large inventories without silently implying omitted items do not exist.

Preserve separate regional and tactical placements, including multiple placements if recorded. No visible placement means “no visible saved placement,” not that the character is at the scene location or with the rest of the party. Group split parties by their actual placements.

When the user wants a map, use the returned mapId and call render_location_map with the same audience and sheet revision. If several maps are relevant, select the one appropriate to the question or ask which they want. For a distant tactical marker, supply a viewport containing its saved coordinates. Show the returned PNG and identify its saved revision; a filename alone is a fallback if the host cannot display image results.

After an authorized gameplay change, fetch a new sheet before describing updated totals. Lookup requests alone do not authorize gameplay changes. Prior chat sheets and PNGs remain snapshots; do not claim they refresh automatically. Use existing campaign play tools/skills when the user actually requests an action.
