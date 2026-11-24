/**
 * Starts the local test harness until Ctrl+C:
 *   npm run harness              # fixtures + mock agent + Life Hub (node) + HTTPS proxy
 *   npm run harness -- docker    # same, Life Hub from the `life-hub:test` image
 *   npm run harness -- none      # only fixtures, mock agent and proxy
 */
import { PORTS, startHarness, type AppMode } from './harness.ts';

const mode = (process.argv[2] ?? 'node') as AppMode;
const harness = await startHarness(mode, process.env.IMAGE ?? 'life-hub:test');
console.log(`Life Hub (HTTPS proxy): ${harness.appUrl}`);
console.log(`Life Hub (direct):      http://<host>:${PORTS.app}  MCP: http://<host>:${PORTS.mcp}/mcp`);
console.log(`Fixtures for the app:   ${harness.fixturesForApp}/feeds/news.xml`);
console.log(`YouTube handle:         ${harness.fixturesForApp}/@lifehub-test`);

const stop = async () => {
  await harness.stop();
  process.exit(0);
};
process.on('SIGINT', () => void stop());
process.on('SIGTERM', () => void stop());
