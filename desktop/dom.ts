// Element IDs are checked against their expected tags once and then cached.
export function elements<const T extends Record<string, keyof HTMLElementTagNameMap>>(tags: T) {
  const cache = new Map<keyof T, HTMLElement>();
  return function <K extends keyof T>(id: K): HTMLElementTagNameMap[T[K]] {
    let element = cache.get(id);
    if (!element) {
      const found = document.getElementById(String(id));
      if (!found || found.tagName.toLowerCase() !== tags[id])
        throw new Error(`Missing or invalid UI element: ${String(id)}`);
      element = found;
      cache.set(id, element);
    }
    // The tag check above establishes this relation; callers cannot choose arbitrary element types.
    return element as HTMLElementTagNameMap[T[K]];
  };
}
export function node<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  text?: string | number,
  className?: string,
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  if (text !== undefined) element.textContent = String(text);
  if (className) element.className = className;
  return element;
}
export function errorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(
    /^Error invoking remote method '[^']+': (?:Error|GeminiSpeechError): /,
    '',
  );
}
export interface ActiveMapState {
  maps: { id: string }[];
  scene?: { map?: string };
  party?: { members: { placements: { mapId: string; level: string }[] }[] };
}
export function resolveActiveMap(
  state: ActiveMapState,
  currentMap: string,
  lastSceneMap: string | undefined,
  lastPartyMap: string | undefined,
): { selectedMap: string; lastSceneMap: string | undefined; lastPartyMap: string | undefined } {
  const has = (id?: string): id is string => !!id && state.maps.some((m) => m.id === id);
  const sceneMap = has(state.scene?.map) ? state.scene!.map : undefined;
  const partyMap = state.party?.members
    .flatMap((m) => m.placements)
    .find((p) => p.level === 'tactical' && has(p.mapId))?.mapId;
  let selectedMap = currentMap;
  if (sceneMap && sceneMap !== lastSceneMap) selectedMap = sceneMap;
  else if (partyMap && partyMap !== lastPartyMap) selectedMap = partyMap;
  else if (!has(selectedMap)) selectedMap = sceneMap ?? partyMap ?? state.maps[0]?.id ?? '';
  return { selectedMap, lastSceneMap: sceneMap, lastPartyMap: partyMap };
}
