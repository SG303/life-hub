import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { log } from './core/log.js';

const app = createApp(loadConfig());

let stopping = false;
async function shutdown(signal: string): Promise<void> {
  if (stopping) return;
  stopping = true;
  log.info('shutting down', { signal });
  const force = setTimeout(() => process.exit(1), 10_000);
  force.unref();
  await app.stop();
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

await app.start();
