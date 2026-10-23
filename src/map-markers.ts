import { Entity, State } from './schema.js';

export type MarkerAppearance = {
  kind: 'character' | 'npc' | 'object';
  label: string;
  color: string;
  shape: 'circle' | 'triangle' | 'diamond';
  dotted: boolean;
  textColor?: string;
};

// Okabe-Ito colorblind-friendly palette: https://jfly.uni-koeln.de/color/
export const FEATURE_PALETTE = [
  '#E69F00',
  '#56B4E9',
  '#009E73',
  '#F0E442',
  '#0072B2',
  '#D55E00',
  '#CC79A7',
  '#000000',
] as const;

export type FeatureMarkerAppearance = {
  kind: 'landmark' | 'object';
  shape: 'triangle' | 'diamond';
  color: string;
  label: string;
  textColor: string;
  dotted: false;
};

const palette = ['#1d4ed8', '#9d174d', '#166534', '#6d28d9', '#b45309', '#0369a1'];

/** Stable marker semantics shared by map renderers and player-facing UI. */
export function markerAppearance(entity: Entity): MarkerAppearance {
  const kind = entity.kind === 'character' ? 'character' : entity.kind === 'npc' ? 'npc' : 'object';
  const words = entity.name.trim().split(/\s+/u).filter(Boolean);
  const initials =
    words.length > 1
      ? Array.from(words[0]!)
          .slice(0, 1)
          .concat(Array.from(words[words.length - 1]!).slice(0, 1))
      : Array.from(words[0] ?? '').slice(0, 2);
  const label = initials.join('').toUpperCase();
  // FNV-1a: deterministic in browsers and Node, with no runtime-specific crypto dependency.
  let hash = 0x811c9dc5;
  for (const char of entity.id) {
    hash ^= char.codePointAt(0)!;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return {
    kind,
    label,
    color: palette[hash % palette.length]!,
    shape: kind === 'object' ? 'triangle' : 'circle',
    dotted: kind === 'npc',
  };
}

export type MapLegendEntry = {
  id: string;
  kind: 'entity' | 'feature';
  label: string;
  position: string;
  appearance:
    | MarkerAppearance
    | { kind: 'terrain' | 'obstacle'; shape: 'square'; dotted: false }
    | FeatureMarkerAppearance;
  featureKind?: 'terrain' | 'obstacle' | 'landmark';
};

/** Build a legend from the entities/features present in the supplied view of state. */
export function mapLegend(state: State, mapId: string): MapLegendEntry[] {
  const map = state.entities[mapId]?.map;
  if (!map) return [];
  const entries: MapLegendEntry[] = [];
  for (const [id, position] of Object.entries(map.tokens).sort(([a], [b]) => a.localeCompare(b))) {
    const entity = state.entities[id];
    if (!entity) continue;
    const location =
      map.kind === 'graph'
        ? position.node
          ? (map.labels?.[position.node] ??
            state.entities[map.locations?.[position.node] ?? '']?.name ??
            position.node)
          : undefined
        : `(${position.x},${position.y})`;
    if (location === undefined) continue;
    entries.push({
      id,
      kind: 'entity',
      label: entity.name,
      position: String(location),
      appearance: markerAppearance(entity),
    });
  }
  for (const feature of map.features ?? [])
    entries.push({
      id: feature.id,
      kind: 'feature',
      label: feature.label,
      position: `(${feature.x},${feature.y})`,
      featureKind: feature.kind,
      appearance:
        feature.kind === 'landmark'
          ? {
              kind: 'landmark',
              shape: 'triangle',
              color: '',
              label: '',
              textColor: '',
              dotted: false,
            }
          : { kind: feature.kind, shape: 'square', dotted: false },
    });

  const allocated = entries
    .filter((entry) =>
      entry.kind === 'feature'
        ? entry.featureKind === 'landmark'
        : entry.appearance.kind === 'object',
    )
    .sort((a, b) => `${a.kind}:${a.id}`.localeCompare(`${b.kind}:${b.id}`));
  for (const [index, entry] of allocated.entries()) {
    const color = FEATURE_PALETTE[index % FEATURE_PALETTE.length]!;
    const rgb = color.slice(1);
    const channels = [0, 2, 4].map((offset) => parseInt(rgb.slice(offset, offset + 2), 16) / 255);
    const linear = channels.map((channel) =>
      channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4,
    );
    const luminance = 0.2126 * linear[0]! + 0.7152 * linear[1]! + 0.0722 * linear[2]!;
    const whiteContrast = 1.05 / (luminance + 0.05);
    const blackContrast = (luminance + 0.05) / 0.05;
    entry.appearance = {
      kind: entry.kind === 'feature' ? 'landmark' : 'object',
      shape: Math.floor(index / FEATURE_PALETTE.length) % 2 === 0 ? 'triangle' : 'diamond',
      color,
      label: String(index + 1),
      textColor: blackContrast >= whiteContrast ? '#000000' : '#FFFFFF',
      dotted: false,
    };
  }
  return entries;
}
