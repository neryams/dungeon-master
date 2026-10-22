import { CampaignError, mapLevel } from './domain.js';
import { State, Entity } from './schema.js';

// Callers supply an audience-filtered snapshot. Never join back to unfiltered state.
export function characterSheet(state: State, characterId: string) {
  const entity = state.entities[characterId];
  if (!entity || entity.kind !== 'character' || !entity.character)
    throw new CampaignError('NOT_FOUND', 'Character not found');
  const inventory = Object.values(state.entities)
    .filter(
      (e): e is Entity & { item: NonNullable<Entity['item']> } =>
        e.kind === 'item' && e.item?.owner === characterId,
    )
    .sort((a, b) => a.id.localeCompare(b.id));
  const placements = Object.values(state.entities)
    .filter((e) => e.map?.tokens[characterId])
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((e) => {
      const map = e.map!,
        position = map.tokens[characterId];
      const locationId = position.node ? map.locations?.[position.node] : undefined;
      const location = locationId ? state.entities[locationId] : undefined;
      return {
        mapId: e.id,
        mapName: e.name,
        kind: map.kind,
        level: mapLevel(map),
        scale: map.scale,
        position,
        ...(position.node
          ? { nodeLabel: map.labels?.[position.node] ?? location?.name ?? position.node }
          : {}),
        ...(location ? { location: { id: location.id, name: location.name } } : {}),
      };
    });
  return { character: { ...entity, character: entity.character }, inventory, placements };
}

export function partyOverview(state: State) {
  const rosterSource = state.party === undefined ? 'legacy-characters' : 'explicit';
  const ids =
    state.party ??
    Object.values(state.entities)
      .filter((e) => e.kind === 'character')
      .map((e) => e.id)
      .sort();
  const members = ids.map((id) => {
    const sheet = characterSheet(state, id),
      character = sheet.character.character;
    return {
      id,
      name: sheet.character.name,
      hp: character.hp,
      maxHp: character.maxHp,
      tempHp: character.tempHp,
      ac: character.ac,
      conditions: character.conditions,
      resources: character.resources,
      inventoryEntries: sheet.inventory.length,
      placements: sheet.placements,
    };
  });
  return { rosterSource, members };
}
