import sharp from 'sharp';
import { createHash } from 'node:crypto';
import { mkdir, readFile, stat } from 'node:fs/promises';
import { z } from 'zod';
import { Entity, State, Viewport } from './schema.js';
import { CampaignError, cellRevealed, partyState } from './domain.js';
import { atomicWrite, safePath } from './store.js';
import { geometryFingerprint } from './map-art.js';

export type RenderMode = 'map' | 'reference';
type BackgroundImage = { data: string; extent: z.infer<typeof Viewport> };
const CELL = 38;

const esc = (s: unknown) =>
  String(s).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]!,
  );
const text = (x: number, y: number, s: unknown, size = 14) =>
  `<text x="${x}" y="${y}" font-size="${size}" fill="#111827">${esc(String(s).length > 100 ? String(s).slice(0, 97) + '…' : s)}</text>`;
export function prepareMap(entity: Entity): Entity {
  const e = structuredClone(entity),
    m = e.map!;
  m.level ??= m.kind === 'grid' ? 'tactical' : 'regional';
  if (m.kind === 'grid') {
    if (!m.bounds) throw new CampaignError('INVALID_MAP', 'New grids require explicit bounds');
    m.origin = 'upper-left';
    m.revealedCells ??= [];
    m.revealedRegions ??= [];
  } else {
    m.layout ??= {};
    m.nodes.forEach((n, i) => {
      m.layout![n] ??= { x: 2 + (i % 4) * 5, y: 2 + Math.floor(i / 4) * 4 };
    });
  }
  return e;
}
export function schematic(
  original: State,
  mapId: string,
  audience: 'dm' | 'party',
  requested?: z.infer<typeof Viewport>,
  options: { mode?: RenderMode; background?: BackgroundImage } = {},
) {
  const reference = options.mode === 'reference';
  const background = reference ? undefined : options.background;
  const state = audience === 'party' ? partyState(original) : structuredClone(original);
  const entity = state.entities[mapId];
  if (!entity?.map) throw new CampaignError('NOT_FOUND', 'Map not found');
  const m = entity.map;
  // Legacy graphs use original node indices, so filtering does not rearrange the drawing.
  const layout =
    m.layout ??
    Object.fromEntries(
      original.entities[mapId].map!.nodes.map((n, i) => [
        n,
        { x: 2 + (i % 4) * 5, y: 2 + Math.floor(i / 4) * 4 },
      ]),
    );
  const coords = Object.values(m.tokens);
  const viewport = requested ?? {
    x:
      m.bounds || m.kind === 'graph'
        ? 0
        : Math.floor(Math.min(...(coords.length ? coords.map((p) => p.x ?? 0) : [0]))),
    y:
      m.bounds || m.kind === 'graph'
        ? 0
        : Math.floor(Math.min(...(coords.length ? coords.map((p) => p.y ?? 0) : [0]))),
    width: Math.min(20, m.bounds?.width ?? 20),
    height: Math.min(20, m.bounds?.height ?? 20),
  };
  if (
    !Number.isSafeInteger(viewport.x + viewport.width) ||
    !Number.isSafeInteger(viewport.y + viewport.height)
  )
    throw new CampaignError('INVALID_MAP', 'Invalid viewport extent');
  const cell = CELL,
    left = reference ? 0 : 54,
    top = reference ? 0 : 100,
    w = reference ? viewport.width * cell : Math.max(820, viewport.width * cell + 90),
    gridH = viewport.height * cell;
  const inside = (x: number, y: number) =>
    x >= viewport.x &&
    y >= viewport.y &&
    x < viewport.x + viewport.width &&
    y < viewport.y + viewport.height;
  const px = (x: number) => left + (x - viewport.x + 0.5) * cell;
  const py = (y: number) => top + (y - viewport.y + 0.5) * cell;
  const draw: string[] = reference
    ? []
    : [
        text(20, 28, entity.name, 22),
        text(20, 52, `${m.scale} per cell | ${audience} | saved revision ${state.revision}`),
        text(20, 74, `Origin upper-left; x right, y down | viewport (${viewport.x},${viewport.y})`),
      ];
  if (background) {
    const b = background.extent;
    draw.push(
      `<defs><clipPath id="map-area"><rect x="${left}" y="${top}" width="${viewport.width * cell}" height="${gridH}"/></clipPath></defs>`,
    );
    draw.push(
      `<image x="${left + (b.x - viewport.x) * cell}" y="${top + (b.y - viewport.y) * cell}" width="${b.width * cell}" height="${b.height * cell}" preserveAspectRatio="none" clip-path="url(#map-area)" xlink:href="data:image/png;base64,${background.data}"/>`,
    );
  }
  if (m.kind === 'grid') {
    for (let y = viewport.y; y < viewport.y + viewport.height; y++)
      for (let x = viewport.x; x < viewport.x + viewport.width; x++) {
        const known =
          (!m.bounds || (x >= 0 && y >= 0 && x < m.bounds.width && y < m.bounds.height)) &&
          (audience === 'dm' || cellRevealed(m, x, y));
        const painted =
          background &&
          x >= background.extent.x &&
          y >= background.extent.y &&
          x < background.extent.x + background.extent.width &&
          y < background.extent.y + background.extent.height;
        draw.push(
          `<rect x="${px(x) - cell / 2}" y="${py(y) - cell / 2}" width="${cell}" height="${cell}" fill="${known ? (painted ? 'none' : '#fff') : '#27303f'}" stroke="#64748b"/>`,
        );
      }
    if (!reference) {
      for (let x = viewport.x; x < viewport.x + viewport.width; x++)
        draw.push(text(px(x) - 6, top - 9, x, 12));
      for (let y = viewport.y; y < viewport.y + viewport.height; y++)
        draw.push(text(22, py(y) + 5, y, 12));
    }
    for (const f of m.features ?? [])
      if (inside(f.x, f.y)) {
        if (background) {
          draw.push(
            f.kind === 'landmark'
              ? `<circle cx="${px(f.x)}" cy="${py(f.y)}" r="7" fill="#fef3c7" fill-opacity="0.85" stroke="#78350f" stroke-width="2"/>`
              : `<rect x="${px(f.x) - 16}" y="${py(f.y) - 16}" width="32" height="32" rx="4" fill="none" stroke="white" stroke-width="2" stroke-dasharray="4 3"/>`,
          );
        } else {
          draw.push(
            `<rect x="${px(f.x) - 16}" y="${py(f.y) - 16}" width="32" height="32" fill="${f.kind === 'obstacle' ? '#a1a1aa' : '#bbf7d0'}" stroke="#111827"/>`,
            ...(!reference
              ? [text(px(f.x) - 14, py(f.y) + 4, f.kind === 'obstacle' ? 'X' : '~')]
              : []),
          );
        }
        if (!reference)
          draw.push(
            text(20, top + gridH + 30 + drawFeatureCount() * 19, `${f.label} (${f.x},${f.y})`, 13),
          );
      }
  } else {
    for (const [a, b] of m.edges)
      if (
        layout[a] &&
        layout[b] &&
        inside(layout[a].x, layout[a].y) &&
        inside(layout[b].x, layout[b].y)
      )
        draw.push(
          `<line x1="${px(layout[a].x)}" y1="${py(layout[a].y)}" x2="${px(layout[b].x)}" y2="${py(layout[b].y)}" stroke="#475569" stroke-width="3"/>`,
        );
    for (const n of m.nodes)
      if (layout[n] && inside(layout[n].x, layout[n].y)) {
        const p = layout[n];
        draw.push(
          `<rect x="${px(p.x) - 40}" y="${py(p.y) - 20}" width="80" height="40" rx="5" fill="#e2e8f0"${background ? ' fill-opacity="0.8"' : ''} stroke="#111827"/>`,
          ...(!reference
            ? [
                text(
                  px(p.x) - 40,
                  py(p.y) - 26,
                  m.labels?.[n] ?? state.entities[m.locations?.[n] ?? '']?.name ?? n,
                  13,
                ),
              ]
            : []),
        );
      }
  }
  function drawFeatureCount() {
    return draw.filter((s) => s.includes('font-size="13"')).length;
  }
  const positions: Record<string, unknown> = {};
  const markers = (reference ? [] : Object.entries(m.tokens)).sort(([a], [b]) =>
    a.localeCompare(b),
  );
  const active = original.encounter?.participants[original.encounter.turn]?.id;
  const legend: string[] = [];
  const occupied = new Map<string, number>();
  for (const [id, p] of markers) {
    const point = m.kind === 'grid' ? { x: p.x!, y: p.y! } : layout[p.node!];
    if (!point || !inside(point.x, point.y)) continue;
    positions[id] = p;
    const hash = createHash('sha256').update(id).digest();
    const key = `${point.x},${point.y}`,
      count = occupied.get(key) ?? 0;
    occupied.set(key, count + 1);
    const total = markers.filter(([, q]) =>
      m.kind === 'grid' ? q.x === p.x && q.y === p.y : q.node === p.node,
    ).length;
    const columns = Math.ceil(Math.sqrt(total)),
      rows = Math.ceil(total / columns);
    const spacing = cell / Math.max(columns, rows);
    const x = px(point.x) + ((count % columns) - (columns - 1) / 2) * spacing;
    const y = py(point.y) + (Math.floor(count / columns) - (rows - 1) / 2) * spacing;
    const size = total > 1 ? spacing * 0.34 : 12;
    const color = ['#1d4ed8', '#9d174d', '#166534', '#6d28d9'][hash[0] % 4],
      shape = hash[1] % 3;
    if (id === active)
      draw.push(
        `<circle cx="${x}" cy="${y}" r="${size + (total > 1 ? 2 : 6)}" fill="#fde047" stroke="#111827" stroke-width="2"/>`,
      );
    const attrs = `fill="${color}" stroke="#fff" stroke-width="2"`;
    draw.push(
      shape === 0
        ? `<circle cx="${x}" cy="${y}" r="${size}" ${attrs}/>`
        : shape === 1
          ? `<rect x="${x - size}" y="${y - size}" width="${size * 2}" height="${size * 2}" ${attrs}/>`
          : `<polygon points="${x},${y - size} ${x + size},${y + size} ${x - size},${y + size}" ${attrs}/>`,
    );
    const label = id.slice(0, 2).toUpperCase();
    draw.push(
      `<text x="${x}" y="${y + (total > 1 ? 3 : 4)}" text-anchor="middle" font-size="${total > 1 ? Math.max(5, Math.min(8, size)) : 10}" font-weight="bold" fill="white">${esc(label)}</text>`,
    );
    legend.push(
      `${label} ${['circle', 'square', 'triangle'][shape]} — ${state.entities[id].name}: ${p.node ?? `(${p.x},${p.y})`}${id === active ? ' — active turn' : ''}`,
    );
  }
  const legendY = top + gridH + 40 + (m.features?.length ?? 0) * 20;
  legend.forEach((line, i) => draw.push(text(20, legendY + i * 22, line)));
  const height = reference ? gridH : legendY + legend.length * 22 + 30;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${w}" height="${height}" font-family="DejaVu Sans, sans-serif"><rect width="100%" height="100%" fill="#f8fafc"/>${draw.join('')}</svg>`;
  return {
    svg,
    mode: options.mode ?? 'map',
    positions,
    viewport,
    mapId,
    revision: state.revision,
    audience,
    warnings:
      markers.length > Object.keys(positions).length
        ? ['Some visible markers lie outside the viewport.']
        : [],
  };
}
/** Render only in memory, shared by MCP and the read-only player panel. */
export async function renderMapImage(
  root: string,
  state: State,
  mapId: string,
  audience: 'dm' | 'party',
  viewport?: z.infer<typeof Viewport>,
  mode: RenderMode = 'map',
) {
  const base = schematic(state, mapId, audience, viewport, { mode });
  const visible = audience === 'party' ? partyState(state) : state;
  const map = visible.entities[mapId].map!;
  const original = state.entities[mapId].map!;
  const art =
    mode === 'reference'
      ? undefined
      : map.art
          ?.slice()
          .reverse()
          .find((a) => a.background);
  let background: BackgroundImage | undefined;
  const warnings = [...base.warnings];
  if (art?.background) {
    // Graphs have no spatial reveal mask: never paint concealed nodes or connections.
    const graphHidden =
      audience === 'party' &&
      map.kind === 'graph' &&
      (map.nodes.length !== original.nodes.length || map.edges.length !== original.edges.length);
    const extent = art.background.extent;
    const visibleFeatures = new Set(map.features?.map((f) => f.id));
    const concealedFeature =
      audience === 'party' &&
      original.features?.some(
        (f) =>
          !visibleFeatures.has(f.id) &&
          f.x >= extent.x &&
          f.y >= extent.y &&
          f.x < extent.x + extent.width &&
          f.y < extent.y + extent.height &&
          (map.kind === 'graph' || cellRevealed(map, f.x, f.y)),
      );
    // A painting cannot selectively erase a feature inside an otherwise visible cell.
    if (graphHidden || concealedFeature) {
      warnings.push('Artwork is not available for this player view; using the schematic.');
    } else if (
      !art.background.geometryHash ||
      art.background.geometryHash !== geometryFingerprint(original)
    ) {
      warnings.push('Artwork layout is outdated or unverified; using the schematic.');
    } else {
      try {
        const path = await safePath(root, art.path);
        const file = await stat(path);
        if (!file.isFile() || file.size > 50 * 1024 * 1024) throw Error('Invalid asset');
        const bytes = await readFile(path);
        if (!art.sha256 || createHash('sha256').update(bytes).digest('hex') !== art.sha256)
          throw Error('Changed asset');
        const extent = art.background.extent;
        // Decode to bounded raster pixels before embedding: no SVG/file references survive.
        const png = await sharp(bytes, { limitInputPixels: 40_000_000 })
          .rotate()
          .resize(extent.width * CELL, extent.height * CELL, { fit: 'fill' })
          .png()
          .toBuffer();
        background = { extent, data: png.toString('base64') };
      } catch {
        warnings.push('Artwork is missing, changed, or unreadable; using the schematic.');
      }
    }
  }
  const { svg, ...data } = background
    ? schematic(state, mapId, audience, viewport, { mode, background })
    : base;
  const png = await sharp(Buffer.from(svg)).png().toBuffer();
  return { ...data, warnings, png };
}

export async function renderMap(
  root: string,
  state: State,
  mapId: string,
  audience: 'dm' | 'party',
  viewport?: z.infer<typeof Viewport>,
  mode: RenderMode = 'map',
) {
  const { png, ...data } = await renderMapImage(root, state, mapId, audience, viewport, mode);
  const v = data.viewport;
  const suffix = mode === 'reference' ? '-reference' : '';
  const path = `.dm/maps/${mapId}-r${state.revision}-${audience}-${v.x}_${v.y}_${v.width}_${v.height}${suffix}.png`;
  await mkdir(await safePath(root, '.dm/maps', false), { recursive: true });
  await atomicWrite(await safePath(root, path, false), png);
  return { ...data, path, image: { mimeType: 'image/png' as const, data: png.toString('base64') } };
}
