import { createHash } from 'node:crypto';

type GeometryMap = {
  kind: 'grid' | 'graph';
  scale?: string;
  bounds?: { width: number; height: number };
  origin?: 'upper-left';
  layout?: Record<string, { x: number; y: number }>;
  nodes: string[];
  edges: [string, string][];
  features?: Array<{
    id: string;
    x: number;
    y: number;
    label: string;
    kind: 'terrain' | 'obstacle' | 'landmark';
    location?: string;
  }>;
};

const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Fingerprint static map geometry while ignoring reveals, markers, and artwork. */
export function geometryFingerprint(map: GeometryMap): string {
  const edges = map.edges
    .map((edge) => [...edge].sort())
    .sort((a, b) => compare(JSON.stringify(a), JSON.stringify(b)));
  const features = (map.features ?? [])
    .map(({ id, x, y, label, kind, location }) => ({ id, x, y, label, kind, location }))
    .sort((a, b) => compare(a.id, b.id));
  const canonical = {
    kind: map.kind,
    scale: map.scale,
    bounds: map.bounds,
    origin: map.origin,
    layout: map.layout
      ? Object.fromEntries(Object.entries(map.layout).sort(([a], [b]) => compare(a, b)))
      : undefined,
    nodes: map.layout ? [...map.nodes].sort() : [...map.nodes],
    edges,
    features,
  };
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}
