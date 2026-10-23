import { WorkerEnvelope, dispatchWorker } from './contracts.js';
import { fileURLToPath } from 'node:url';
import { DesktopHost } from './host.js';

const host = new DesktopHost({ source: fileURLToPath(new URL('../..', import.meta.url)) });
host.subscribe((event) => {
  if (!process.connected) return;
  try {
    process.send?.(event);
  } catch {
    /* The window may close during a tool result. */
  }
});
process.on('message', async (raw: unknown) => {
  const parsed = WorkerEnvelope.safeParse(raw);
  if (!parsed.success) return;
  const message = parsed.data;
  try {
    const result = await dispatchWorker(host, message.method, message.args);
    process.send?.({ id: message.id, result });
  } catch (error) {
    process.send?.({
      id: message.id,
      error: error instanceof Error ? error.message : 'Unable to complete the request',
    });
  }
});
let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  host.closeSpeechSetup();
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
