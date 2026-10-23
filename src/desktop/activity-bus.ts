import { randomUUID } from 'node:crypto';
import { createServer, connect, type Server, type Socket } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import { ActivitySnapshot } from './activity.js';

const MAX_MESSAGE = 16 * 1024;
const TIMEOUT = 1000;
export const ActivityNotice = z
  .object({
    token: z.string().uuid(),
    kind: z.enum(['activity', 'changed']),
    requestId: z.string().max(100).optional(),
    operationId: z.string().max(100).optional(),
    activity: ActivitySnapshot.optional(),
  })
  .strict();
export type ActivityNotice = z.infer<typeof ActivityNotice>;

/** An owner-scoped, local-only notification endpoint. Its path is disposable. */
export class ActivityBus {
  private constructor(
    readonly endpoint: string,
    private server: Server,
    private directory?: string,
    private sockets = new Set<Socket>(),
  ) {}

  static async listen(token: string, receive: (notice: ActivityNotice) => Promise<void> | void) {
    const directory =
      process.platform === 'win32' ? undefined : await mkdtemp(join(tmpdir(), 'dm-activity-'));
    const endpoint = directory
      ? join(directory, 'events.sock')
      : `\\\\.\\pipe\\dm-activity-${randomUUID()}`;
    const sockets = new Set<Socket>();
    const server = createServer((socket) => {
      sockets.add(socket);
      socket.once('close', () => sockets.delete(socket));
      let body = Buffer.alloc(0);
      let handled = false;
      socket.setTimeout(TIMEOUT, () => socket.destroy());
      socket.on('data', (chunk: Buffer) => {
        if (handled || body.length + chunk.length > MAX_MESSAGE) return socket.destroy();
        body = Buffer.concat([body, chunk]);
        const newline = body.indexOf(10);
        if (newline < 0) return;
        handled = true;
        const line = body.subarray(0, newline).toString('utf8');
        try {
          const parsed = ActivityNotice.safeParse(JSON.parse(line));
          if (
            parsed.success &&
            parsed.data.token === token &&
            (parsed.data.kind !== 'activity' || parsed.data.activity)
          ) {
            void Promise.resolve(receive(parsed.data)).then(
              () => socket.end('ok'),
              () => socket.destroy(),
            );
            return;
          }
        } catch {
          /* Invalid messages are ignored. */
        }
        socket.destroy();
      });
      socket.on('error', () => {});
    });
    try {
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(endpoint, () => {
          server.off('error', reject);
          resolve();
        });
      });
      return new ActivityBus(endpoint, server, directory, sockets);
    } catch (error) {
      server.close();
      if (directory) await rm(directory, { recursive: true, force: true });
      throw error;
    }
  }

  async close() {
    for (const socket of this.sockets) socket.destroy();
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
    if (this.directory) await rm(this.directory, { recursive: true, force: true });
  }
}

/** Best effort: no gameplay operation depends on a live desktop window. */
export async function notifyActivity(endpoint: string | undefined, notice: ActivityNotice) {
  if (!endpoint || endpoint.length > 256 || !/^(?:\\\\\.\\pipe\\dm-activity-|\/)/.test(endpoint))
    return;
  const message = JSON.stringify(ActivityNotice.parse(notice));
  if (Buffer.byteLength(message) > MAX_MESSAGE - 1) return;
  await new Promise<void>((resolve) => {
    const socket = connect(endpoint);
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      socket.destroy();
      resolve();
    };
    socket.setTimeout(TIMEOUT, finish);
    socket.once('error', finish);
    socket.once('connect', () => socket.write(`${message}\n`));
    socket.once('data', finish);
    socket.once('close', finish);
  });
}
