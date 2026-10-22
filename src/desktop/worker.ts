import { fileURLToPath } from 'node:url';
import { DesktopHost } from './host.js';

const host = new DesktopHost({ source: fileURLToPath(new URL('../..', import.meta.url)) });
const methods = new Set([
  'detect',
  'create',
  'open',
  'connect',
  'submit',
  'snapshot',
  'map',
  'stop',
  'startLan',
  'stopLan',
  'lanStatus',
  'lanAdmin',
]);
process.on('message', async (message: any) => {
  if (
    !message ||
    !Number.isSafeInteger(message.id) ||
    !methods.has(message.method) ||
    !Array.isArray(message.args)
  )
    return;
  try {
    const result = await (host[message.method as keyof DesktopHost] as Function).apply(
      host,
      message.args,
    );
    process.send?.({ id: message.id, result });
  } catch (error) {
    const text = error instanceof Error ? error.message : 'Unable to complete the request';
    process.send?.({ id: message.id, error: text });
  }
});
let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  await host.close();
  process.exit(0);
}
process.on('disconnect', () => {
  void close();
});
process.on('SIGTERM', () => {
  void close();
});
process.on('SIGINT', () => {
  void close();
});
