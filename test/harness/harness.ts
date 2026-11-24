import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { createFixtureHandler } from './fixture-server.ts';
import { createHttpsProxy } from './https-proxy.ts';
import { createMockAgent } from './mock-agent.ts';

/**
 * Self-contained test environment: fixture feeds + fake YouTube, a mock
 * OpenAI-compatible agent that calls Life Hub's MCP endpoint, Life Hub itself
 * (as a Node process or a Docker container) and a TLS proxy in front of it.
 * Everything binds to 0.0.0.0 so a container can reach the fixtures.
 */

export const PORTS = { app: 4600, mcp: 4601, fixtures: 4610, agent: 4620, https: 4643 };
export const SECRETS = {
  mcpToken: 'e2e-mcp-token-0123456789abcdefghijklmnop',
  agentKey: 'e2e-agent-key',
  model: 'mock-hermes',
};
export const DOCKER = { container: 'life-hub-e2e', volume: 'life-hub-e2e-data' };

export type AppMode = 'node' | 'docker' | 'none';

export interface Harness {
  /** Base URL of fixtures as Life Hub sees them (differs in Docker mode). */
  fixturesForApp: string;
  /** HTTPS URL of Life Hub behind the local proxy. */
  appUrl: string;
  stop(): Promise<void>;
}

function listen(server: http.Server, port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '0.0.0.0', () => resolve());
  });
}

function close(server: http.Server): Promise<void> {
  return new Promise((resolve) => {
    server.close(() => resolve());
    server.closeAllConnections();
  });
}

async function waitForHealth(timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORTS.app}/api/v1/health`);
      if (res.ok) return;
    } catch {
      // not up yet
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('Life Hub did not become healthy');
}

interface AppController {
  start(): Promise<void>;
  stop(): Promise<void>;
  restart(): Promise<void>;
}

function appEnv(hostForApp: string): Record<string, string> {
  return {
    TZ: 'Europe/Zurich',
    ALLOWED_HOSTS: '127.0.0.1,localhost',
    TRUSTED_PROXIES: '127.0.0.1,::1,172.16.0.0/12',
    MCP_AUTH_TOKEN: SECRETS.mcpToken,
    AGENT_BASE_URL: `http://${hostForApp}:${PORTS.agent}/v1`,
    AGENT_API_KEY: SECRETS.agentKey,
    AGENT_MODEL: SECRETS.model,
    AGENT_TIMEOUT_MS: '15000',
    ALLOW_PRIVATE_FEED_URLS: 'true',
    YOUTUBE_BASE_URL: `http://${hostForApp}:${PORTS.fixtures}`,
    FEED_REFRESH_INTERVAL_MS: '3600000',
  };
}

function nodeApp(): AppController {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'life-hub-e2e-'));
  let child: ChildProcess | undefined;
  const env = {
    ...process.env,
    ...appEnv('127.0.0.1'),
    HOST: '0.0.0.0',
    PORT: String(PORTS.app),
    MCP_PORT: String(PORTS.mcp),
    DATA_DIR: dataDir,
    WEB_DIR: path.resolve('dist/web'),
    LOG_LEVEL: process.env.LOG_LEVEL ?? 'silent',
  };
  const controller: AppController = {
    async start() {
      child = spawn(process.execPath, ['dist/server/server.js'], { env, stdio: ['ignore', 'inherit', 'inherit'] });
      await waitForHealth();
    },
    async stop() {
      if (!child || child.exitCode !== null) return;
      const exited = new Promise((resolve) => child!.once('exit', resolve));
      child.kill('SIGTERM');
      await exited;
    },
    async restart() {
      await controller.stop();
      await controller.start();
    },
  };
  return controller;
}

function dockerApp(image: string): AppController {
  const docker = (...args: string[]) => execFileSync('docker', args, { stdio: ['ignore', 'pipe', 'inherit'] }).toString().trim();
  const remove = () => {
    execFileSync('docker', ['rm', '-f', DOCKER.container], { stdio: 'ignore' });
    execFileSync('docker', ['volume', 'rm', '-f', DOCKER.volume], { stdio: 'ignore' });
  };
  return {
    async start() {
      remove();
      const env = Object.entries(appEnv('host.docker.internal')).flatMap(([key, value]) => ['-e', `${key}=${value}`]);
      docker(
        'run', '-d', '--name', DOCKER.container,
        '--add-host', 'host.docker.internal:host-gateway',
        '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges:true',
        '-p', `${PORTS.app}:3000`, '-p', `${PORTS.mcp}:3001`,
        '-v', `${DOCKER.volume}:/data`,
        ...env,
        image,
      );
      await waitForHealth(60_000);
    },
    async stop() {
      remove();
    },
    async restart() {
      docker('restart', DOCKER.container);
      await waitForHealth(60_000);
    },
  };
}

export async function startHarness(mode: AppMode, image = 'life-hub:test'): Promise<Harness> {
  const hostForApp = mode === 'docker' ? 'host.docker.internal' : '127.0.0.1';
  const fixturesForApp = `http://${hostForApp}:${PORTS.fixtures}`;

  const agent = createMockAgent({
    apiKey: SECRETS.agentKey,
    model: SECRETS.model,
    mcpUrl: `http://127.0.0.1:${PORTS.mcp}/mcp`,
    mcpToken: SECRETS.mcpToken,
  });
  let agentUp = false;
  const startAgent = async () => {
    if (!agentUp) await listen(agent.server, PORTS.agent);
    agentUp = true;
  };
  const stopAgent = async () => {
    if (agentUp) await close(agent.server);
    agentUp = false;
  };

  const app = mode === 'node' ? nodeApp() : mode === 'docker' ? dockerApp(image) : undefined;
  const fixtures = createFixtureHandler(() => fixturesForApp);
  const fixtureServer = http.createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url ?? '/', 'http://x.invalid');
      const ok = (body: unknown = { ok: true }) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(body));
      };
      try {
        if (req.method === 'POST' && url.pathname === '/__control/agent/stop') return ok(await stopAgent());
        if (req.method === 'POST' && url.pathname === '/__control/agent/start') return ok(await startAgent());
        if (req.method === 'POST' && url.pathname === '/__control/app/restart') return ok(await app?.restart());
        if (url.pathname === '/__control/agent/turns') return ok(agent.turns);
        if (url.pathname === '/__control/info') return ok({ fixturesForApp, mode });
        if (!fixtures(req, res)) {
          res.writeHead(404);
          res.end('not found');
        }
      } catch (error) {
        res.writeHead(500);
        res.end(String(error));
      }
    })();
  });

  const proxy = createHttpsProxy({ host: '127.0.0.1', port: PORTS.app });
  await listen(fixtureServer, PORTS.fixtures);
  await startAgent();
  await app?.start();
  await listen(proxy, PORTS.https);

  return {
    fixturesForApp,
    appUrl: `https://127.0.0.1:${PORTS.https}`,
    async stop() {
      await close(proxy);
      await app?.stop();
      await stopAgent();
      await close(fixtureServer);
    },
  };
}
