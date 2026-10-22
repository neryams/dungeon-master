import { createServer, type Server, type IncomingMessage } from 'node:http';
import { randomBytes, randomUUID } from 'node:crypto';
import { networkInterfaces } from 'node:os';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import QRCode from 'qrcode';
import {
  IntentInput as Intent,
  LanAdminInput,
  MapInput,
  LanJoinInput,
  LanClaimInput,
} from './contracts.js';
import type { LanSnapshot, LanStatus, LanResponses } from './contracts.js';
import type { DesktopHost } from './host.js';

const secret = () => randomBytes(32).toString('hex');
type Client = { id: string; name: string; characterId?: string; seen: number };

// Sessions are disposable access credentials. All accepted game intentions are event-backed.
export class LanGame {
  private server!: Server;
  private invitation = secret();
  private clients = new Map<string, Client>();
  private addresses: string[] = [];
  private port = 0;
  private queue: Promise<unknown> = Promise.resolve();
  private closed = false;
  private rates = new Map<string, { start: number; count: number }>();
  private constructor(
    private host: DesktopHost,
    private source: string,
  ) {}
  static async start(host: DesktopHost, source: string) {
    const game = new LanGame(host, source);
    await game.listen();
    return game;
  }
  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.queue.then(() => {
      if (this.closed) throw new Error('Sharing stopped');
      return fn();
    });
    this.queue = next.catch(() => {});
    return next;
  }
  private async listen() {
    this.addresses = [
      ...new Set([
        '127.0.0.1',
        ...Object.values(networkInterfaces()).flatMap((es) =>
          (es ?? []).filter((e) => e.family === 'IPv4' && !e.internal).map((e) => e.address),
        ),
      ]),
    ];
    const assets = new Map(
      await Promise.all(
        [
          'lan.html',
          'lan.js',
          'lan.css',
          'dom.js',
          'markdown.js',
          'markdown.css',
          'vendor/markdown-it.js',
        ].map(
          async (file) =>
            [
              file === 'lan.html' ? '/' : `/${file}`,
              await readFile(join(this.source, 'build/desktop', file)),
            ] as const,
        ),
      ),
    );
    this.server = createServer(async (req, res) => {
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Referrer-Policy', 'no-referrer');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader(
        'Content-Security-Policy',
        "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
      );
      const send = (status: number, data: unknown, type = 'application/json') => {
        res.writeHead(status, { 'Content-Type': type });
        res.end(Buffer.isBuffer(data) ? data : JSON.stringify(data));
      };
      try {
        if (!this.addresses.some((a) => req.headers.host === `${a}:${this.port}`))
          return send(403, { error: 'Invalid host' });
        if (req.headers.origin && req.headers.origin !== `http://${req.headers.host}`)
          return send(403, { error: 'Invalid origin' });
        const suppliedToken = (req.headers.authorization ?? '').replace(/^Bearer /, '');
        const rateKey = this.clients.has(suppliedToken)
          ? suppliedToken
          : (req.socket.remoteAddress ?? '');
        let rate = this.rates.get(rateKey);
        if (!rate || Date.now() - rate.start > 60000) {
          rate = { start: Date.now(), count: 0 };
          if (this.rates.size > 500) this.rates.clear();
          this.rates.set(rateKey, rate);
        }
        if (++rate.count > 300) return send(429, { error: 'Too many requests. Wait a minute.' });
        const path = req.url ?? '/';
        if (req.method === 'GET' && assets.has(path))
          return send(
            200,
            assets.get(path),
            path === '/'
              ? 'text/html; charset=utf-8'
              : path.endsWith('.js')
                ? 'text/javascript; charset=utf-8'
                : 'text/css; charset=utf-8',
          );
        if (path === '/api/join' && req.method === 'POST') {
          const input = LanJoinInput.parse(await body(req));
          if (input.invitation !== this.invitation)
            return send(401, { error: 'Ask the host for a new join link' });
          return send(
            200,
            await this.serial(async () => {
              if (this.clients.size >= 20) throw new Error('Game is full');
              const token = secret();
              const client = { id: randomUUID(), name: input.name, seen: Date.now() };
              this.clients.set(token, client);
              return { token, clientId: client.id };
            }),
          );
        }
        const client = this.clients.get((req.headers.authorization ?? '').replace(/^Bearer /, ''));
        if (!client) return send(401, { error: 'Join again with the host’s link' });
        client.seen = Date.now();
        if (path === '/api/state' && req.method === 'GET')
          return send(200, await this.snapshot(client));
        if (req.method !== 'POST') return send(405, { error: 'Unsupported request' });
        const input = await body(req);
        if (path === '/api/map') return send(200, await this.host.map(MapInput.parse(input)));
        if (path === '/api/claim')
          return send(200, await this.serial(() => this.claim(client, input)));
        if (path === '/api/intent')
          return send(200, await this.serial(() => this.intent(client, input)));
        return send(404, { error: 'Not found' });
      } catch (error) {
        // Never forward filesystem, CLI, or internal service error text over LAN.
        send(409, {
          error:
            error instanceof Error && error.name === 'ZodError'
              ? 'Invalid request'
              : 'Request not accepted. Refresh the table and check your seat, turn, and connection.',
        });
      }
    });
    this.server.requestTimeout = 10000;
    this.server.headersTimeout = 10000;
    this.server.maxConnections = 64;
    await new Promise<void>((resolve, reject) => {
      this.server.once('error', reject);
      this.server.listen(0, '0.0.0.0', resolve);
    });
    this.port = (this.server.address() as { port: number }).port;
  }
  private players() {
    return [...this.clients.values()].map((c) => ({
      id: c.id,
      name: c.name,
      characterId: c.characterId,
      connected: Date.now() - c.seen < 15000,
    }));
  }
  async status(): Promise<LanStatus> {
    const urls = this.addresses.map((a) => `http://${a}:${this.port}/#${this.invitation}`);
    return {
      urls,
      qrs: await Promise.all(urls.map((u) => QRCode.toDataURL(u))),
      players: this.players(),
    };
  }
  private async snapshot(client: Client): Promise<LanSnapshot> {
    const s = await this.host.snapshot();
    if (!s.campaign) throw new Error('No campaign');
    return {
      campaign: s.campaign,
      revision: s.revision,
      party: s.party,
      sheets: s.sheets,
      scene: s.scene,
      focus: s.focus,
      quests: s.quests,
      maps: s.maps,
      encounter: s.encounter,
      table: s.table,
      gathering: s.gathering,
      stage: s.stage,
      players: this.players(),
      self: { id: client.id, characterId: client.characterId },
      required: this.required(s),
    };
  }
  private required(s: Awaited<ReturnType<DesktopHost['snapshot']>>): string[] {
    if (!s.campaign) return [];
    if (s.gathering?.request) return s.gathering.request.characterIds;
    if (s.encounter)
      return s.encounter.activeId && s.party.members.some((p) => p.id === s.encounter!.activeId)
        ? [s.encounter.activeId]
        : [];
    return s.gathering?.seats ?? [];
  }
  private async saveSeats() {
    await this.host.tableChange(
      {
        type: 'seats',
        characterIds: [...this.clients.values()].flatMap((c) =>
          c.characterId ? [c.characterId] : [],
        ),
      },
      `lan-seats-${randomUUID()}`,
    );
  }
  private async claim(client: Client, raw: unknown): Promise<LanResponses['claim']> {
    if (![...this.clients.values()].includes(client)) throw new Error('Session revoked');
    const { characterId } = LanClaimInput.parse(raw);
    const s = await this.host.snapshot();
    if (!s.campaign || !s.party.members.some((p) => p.id === characterId))
      throw new Error('Unavailable character');
    if ([...this.clients.values()].some((c) => c !== client && c.characterId === characterId))
      throw new Error('Already claimed');
    if (client.characterId === characterId) return { ok: true };
    // Explicitly reassignment only by host once a character is claimed.
    if (client.characterId) throw new Error('Ask host to release your seat');
    client.characterId = characterId;
    try {
      await this.saveSeats();
    } catch (e) {
      client.characterId = undefined;
      throw e;
    }
    return { ok: true };
  }
  private async intent(client: Client, raw: unknown): Promise<LanResponses['intent']> {
    if (![...this.clients.values()].includes(client)) throw new Error('Session revoked');
    const i = Intent.parse(raw);
    const s = await this.host.snapshot();
    const characterId = client.characterId;
    if (!s.campaign || !characterId) throw new Error('Claim a character');
    if (await this.host.hasTableOperation(`lan-intent-${i.id}`)) {
      await this.host.tableChange(
        {
          type: 'intent',
          epoch: i.epoch,
          action: { characterId, text: i.text, pass: i.pass, confirmed: i.confirmed || i.sendNow },
        },
        `lan-intent-${i.id}`,
      );
      await this.dispatch(i.sendNow ? characterId : undefined);
      return { ok: true, duplicate: true };
    }
    if (s.gathering?.request && !this.required(s).includes(characterId))
      throw new Error('Waiting for another player');
    if (
      (i.confirmed || i.sendNow) &&
      (s.stage !== 'ready' || !this.required(s).includes(characterId))
    )
      throw new Error('Wait for your turn');
    if (i.sendNow && s.gathering?.request) throw new Error('Wait for all requested replies');
    await this.host.tableChange(
      {
        type: 'intent',
        epoch: i.epoch,
        action: { characterId, text: i.text, pass: i.pass, confirmed: i.confirmed || i.sendNow },
      },
      `lan-intent-${i.id}`,
    );
    await this.dispatch(i.sendNow ? characterId : undefined);
    return { ok: true };
  }
  private async dispatch(only?: string, override = false) {
    const s = await this.host.snapshot();
    if (!s.campaign || s.stage !== 'ready') return;
    const required = this.required(s);
    const actions = (only ? [only] : required)
      .map((id) => s.gathering?.actions[id])
      .filter((a): a is NonNullable<typeof a> => a?.confirmed === true);
    if (!actions.length || (!only && !override && actions.length !== required.length)) return;
    const text = s.gathering?.request
      ? 'These are the requested player replies. Resume the pending decision without repeating saved effects.'
      : s.encounter
        ? 'Resolve the active character’s confirmed intention in initiative order.'
        : 'Resolve these confirmed group intentions in causal order.';
    await this.host.submit(
      { id: randomUUID(), text, actions, groupEpoch: s.gathering?.epoch },
      true,
    );
  }
  async admin(raw: unknown) {
    const i = LanAdminInput.parse(raw);
    return this.serial(async () => {
      if (i.action === 'rotate') this.invitation = secret();
      else if (i.action === 'resolve') await this.dispatch(undefined, true);
      else if (i.action === 'continue') {
        const s = await this.host.snapshot();
        if (!s.campaign || !s.encounter || this.required(s).length || s.gathering?.request)
          throw new Error('Player response needed');
        await this.host.submit(
          {
            id: randomUUID(),
            text: 'Continue the current NPC initiative turn. Pause before any player reaction decision. Do not skip player turns.',
          },
          true,
        );
      } else if (i.action === 'skip') {
        const s = await this.host.snapshot();
        if (!s.campaign || !i.characterId || !this.required(s).includes(i.characterId))
          throw new Error('Not required');
        await this.host.tableChange(
          {
            type: 'intent',
            epoch: s.gathering?.epoch ?? 0,
            action: {
              characterId: i.characterId,
              text: 'Host explicitly passed for this character.',
              pass: true,
              confirmed: true,
            },
          },
          `lan-skip-${randomUUID()}`,
        );
        await this.dispatch();
      } else {
        const pair = [...this.clients].find(([, c]) => c.id === i.clientId);
        if (!pair) throw new Error('Unknown player');
        if (i.action === 'assign') {
          const s = await this.host.snapshot();
          if (
            !s.campaign ||
            !i.characterId ||
            !s.party.members.some((p) => p.id === i.characterId) ||
            [...this.clients.values()].some((c) => c !== pair[1] && c.characterId === i.characterId)
          )
            throw new Error('Character unavailable');
          pair[1].characterId = i.characterId;
        } else pair[1].characterId = undefined;
        if (i.action === 'remove') this.clients.delete(pair[0]);
        await this.saveSeats();
        await this.host.tableChange({ type: 'reset_intents' }, `lan-reset-${randomUUID()}`);
      }
      return this.status();
    });
  }
  async close() {
    this.closed = true;
    await this.queue;
    this.clients.clear();
    this.server.closeAllConnections();
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
  }
}
async function body(req: IncomingMessage): Promise<unknown> {
  if (!req.headers['content-type']?.startsWith('application/json'))
    throw new Error('JSON required');
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 65536) throw new Error('Request too large');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
