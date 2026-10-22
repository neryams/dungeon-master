import { createServer } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { networkInterfaces } from 'node:os';
import { CampaignStore } from './store.js';
import { partyState } from './domain.js';
import { playerView } from './player-view.js';
import { renderMapImage } from './maps.js';
import { Id, Viewport } from './schema.js';
import { html, script, css } from './panel-ui.js';

export async function startPanel(root: string, options: { lan?: boolean; port?: number } = {}) {
  const store = await CampaignStore.open(root);
  const token = randomBytes(32).toString('hex');
  const addresses = Object.values(networkInterfaces()).flatMap((entries) =>
    (entries ?? []).filter((e) => e.family === 'IPv4' && !e.internal).map((e) => e.address),
  );
  const hosts = new Set(['localhost', '127.0.0.1', ...(options.lan ? addresses : [])]);
  const cache = new Map<string, { png: Buffer; warnings: string[] }>();
  let cachedRevision = -1;
  let rendering = false;
  const server = createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' blob:; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
    );
    const send = (status: number, body: string | Buffer, type = 'application/json') => {
      res.writeHead(status, { 'Content-Type': type });
      res.end(body);
    };
    try {
      const host = req.headers.host ?? '';
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      if (![...hosts].some((h) => host === `${h}:${port}`))
        return send(403, '{"error":"Invalid host"}');
      if (req.headers.origin && req.headers.origin !== `http://${host}`)
        return send(403, '{"error":"Invalid origin"}');
      if (req.method !== 'GET') return send(405, '{"error":"Read-only server"}');
      const url = new URL(req.url ?? '/', `http://${host}`);
      if (!url.search) {
        if (url.pathname === '/') return send(200, html, 'text/html; charset=utf-8');
        if (url.pathname === '/panel.js')
          return send(200, script, 'text/javascript; charset=utf-8');
        if (url.pathname === '/panel.css') return send(200, css, 'text/css; charset=utf-8');
      }
      const supplied = Buffer.from(req.headers.authorization ?? '');
      const expected = Buffer.from(`Bearer ${token}`);
      if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected))
        return send(401, '{"error":"Open the access link printed by the panel server"}');
      if (url.pathname !== '/api/state' && url.pathname !== '/api/map')
        return send(404, '{"error":"Not found"}');
      const allowed =
        url.pathname === '/api/state' ? [] : ['mapId', 'revision', 'x', 'y', 'width', 'height'];
      if (
        [...url.searchParams.keys()].some(
          (k) => !allowed.includes(k) || url.searchParams.getAll(k).length !== 1,
        )
      )
        return send(400, '{"error":"Invalid parameters"}');
      const { state: original } = await store.read();
      const state = partyState(original);
      if (url.pathname === '/api/state') {
        return send(200, JSON.stringify(playerView(original, store.config)));
      }
      const id = Id.parse(url.searchParams.get('mapId'));
      const revisionText = url.searchParams.get('revision');
      if (!revisionText || !/^\d+$/.test(revisionText))
        return send(400, '{"error":"Revision required"}');
      if (Number(revisionText) !== state.revision) return send(409, '{"error":"Refresh state"}');
      if (!state.entities[id]?.map) return send(404, '{"error":"Map not found"}');
      const fields = ['x', 'y', 'width', 'height'] as const;
      const viewport = fields.some((k) => url.searchParams.has(k))
        ? Viewport.parse(
            Object.fromEntries(
              fields.map((k) => [
                k,
                url.searchParams.has(k) ? Number(url.searchParams.get(k)) : NaN,
              ]),
            ),
          )
        : undefined;
      if (
        viewport &&
        (!Number.isSafeInteger(viewport.x + viewport.width) ||
          !Number.isSafeInteger(viewport.y + viewport.height))
      )
        return send(400, '{"error":"Invalid viewport extent"}');
      if (cachedRevision !== state.revision) {
        cache.clear();
        cachedRevision = state.revision;
      }
      const key = JSON.stringify([state.revision, id, viewport]);
      let rendered = cache.get(key);
      if (!rendered) {
        if (rendering) return send(503, '{"error":"Map renderer busy; retry"}');
        rendering = true;
        try {
          const { png, warnings } = await renderMapImage(
            store.root,
            original,
            id,
            'party',
            viewport,
          );
          rendered = { png, warnings };
          if (cache.size >= 8) cache.delete(cache.keys().next().value!);
          cache.set(key, rendered);
        } finally {
          rendering = false;
        }
      }
      // Never send a render from before a concurrently committed update.
      if ((await store.read()).state.revision !== state.revision)
        return send(409, '{"error":"Refresh state"}');
      res.setHeader('X-Campaign-Revision', String(state.revision));
      if (rendered.warnings.length)
        res.setHeader('X-Map-Warnings', encodeURIComponent(JSON.stringify(rendered.warnings)));
      return send(200, rendered.png, 'image/png');
    } catch (error) {
      const invalid = error instanceof Error && error.name === 'ZodError';
      send(
        invalid ? 400 : 500,
        JSON.stringify({
          error: invalid ? 'Invalid parameters' : 'Unable to read or render campaign; retry',
        }),
      );
    }
  });
  server.requestTimeout = 10000;
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port ?? 4317, options.lan ? '0.0.0.0' : '127.0.0.1', resolve);
  });
  const port = (server.address() as { port: number }).port;
  return {
    server,
    token,
    port,
    urls: ['127.0.0.1', ...(options.lan ? addresses : [])].map(
      (h) => `http://${h}:${port}/#${token}`,
    ),
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.closeAllConnections();
        server.close((e) => (e ? reject(e) : resolve()));
      }),
  };
}
