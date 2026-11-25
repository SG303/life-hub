import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import type { Config } from './config.js';
import { backupDatabase, openDatabase, type Db } from './core/db.js';
import { handleApi, HttpError, parseJson, readBody, requestUrl, Router, sendJson } from './core/http.js';
import { log } from './core/log.js';
import {
  hostnameOf,
  ipMatcher,
  isAllowedHost,
  isJsonContentType,
  isMutating,
  isSameOrigin,
  requestOrigin,
  setSecurityHeaders,
} from './core/security.js';
import { serveStatic } from './core/static.js';
import { createMcpHandler, MIN_TOKEN_LENGTH } from './mcp/server.js';
import { createChatModule, type ChatModule } from './modules/chat/index.js';
import { createCockpitModule } from './modules/cockpit/index.js';
import { createFeedsModule, type FeedsModule, type Fetcher } from './modules/feeds/index.js';
import { createTasksModule, type TasksModule } from './modules/tasks/index.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const API_BODY_LIMIT = 2 * 1024 * 1024;

export function readVersion(): string {
  try {
    const file = path.resolve(import.meta.dirname, '../../package.json');
    return (JSON.parse(fs.readFileSync(file, 'utf8')) as { version: string }).version;
  } catch {
    return '0.0.0';
  }
}

/** Last-resort boundary: a failing request must never become an unhandled rejection that ends the process. */
function failRequest(res: http.ServerResponse, error: unknown): void {
  log.error('request failed', { error: String(error) });
  if (!res.headersSent) sendJson(res, 500, { error: { code: 'internal', message: 'Interner Fehler.' } });
  else res.destroy();
}

export interface AppOverrides {
  db?: Db;
  fetcher?: Fetcher;
  agentFetch?: typeof fetch;
}

export interface App {
  db: Db;
  tasks: TasksModule;
  feeds: FeedsModule;
  chat: ChatModule;
  api: Router;
  uiServer: http.Server;
  mcpServer: http.Server;
  start(): Promise<void>;
  stop(): Promise<void>;
}

export function createApp(config: Config, overrides: AppOverrides = {}): App {
  const version = readVersion();
  const db = overrides.db ?? openDatabase(config.dataDir, { backupKeep: config.backupKeep });
  const tasks = createTasksModule(db, config.timeZone);
  const feeds = createFeedsModule(db, config.feeds, overrides.fetcher);
  const chat = createChatModule(
    db,
    config.agent,
    { task: (id) => tasks.service.get(id), feedItem: (id) => feeds.service.getItem(id) },
    overrides.agentFetch,
  );
  const cockpit = createCockpitModule([tasks.cockpit, feeds.cockpit]);

  const api = new Router()
    .get('/api/v1/health', () => ({ status: 'ok', version }))
    .mount('/api/v1/cockpit', cockpit.routes)
    .mount('/api/v1/tasks', tasks.routes)
    .mount('/api/v1/feeds', feeds.routes)
    .mount('/api/v1/chat', chat.routes);

  const isTrustedProxy = ipMatcher(config.trustedProxies);

  const uiServer = http.createServer((req, res) => {
    void (async () => {
      setSecurityHeaders(res);
      const origin = requestOrigin(req, isTrustedProxy);
      // Check the raw Host header too: behind Docker port publishing every client arrives from the
      // bridge gateway, so X-Forwarded-Host alone must not make a DNS-rebound Host acceptable.
      const rawHostname = hostnameOf((req.headers.host ?? '').toLowerCase());
      if (!isAllowedHost(origin.hostname, config.allowedHosts) || !isAllowedHost(rawHostname, config.allowedHosts)) {
        res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Host nicht erlaubt (ALLOWED_HOSTS).');
        return;
      }
      const url = requestUrl(req, 'http://app.invalid');
      if (!url) {
        sendJson(res, 400, { error: { code: 'bad_request', message: 'Ungültige Anfrage.' } });
        return;
      }
      if (!url.pathname.startsWith('/api/')) {
        serveStatic(config.webDir, req, res, url);
        return;
      }
      try {
        let body: unknown;
        if (isMutating(req.method)) {
          if (!isSameOrigin(req, origin)) throw new HttpError(403, 'cross_origin', 'Anfrage von fremder Herkunft abgelehnt.');
          const text = await readBody(req, API_BODY_LIMIT);
          if (req.method !== 'DELETE' && !isJsonContentType(req)) {
            throw new HttpError(415, 'json_required', 'Nur JSON-Anfragen werden akzeptiert.');
          }
          if (req.method === 'DELETE' && text.trim() !== '' && !isJsonContentType(req)) {
            throw new HttpError(415, 'json_required', 'Nur JSON-Anfragen werden akzeptiert.');
          }
          body = parseJson(text);
        }
        await handleApi(api, req, res, url, body);
      } catch (error) {
        if (error instanceof HttpError) {
          sendJson(res, error.status, { error: { code: error.code, message: error.message } });
          return;
        }
        log.error('request failed', { path: url.pathname, error: String(error) });
        if (!res.headersSent) sendJson(res, 500, { error: { code: 'internal', message: 'Interner Fehler.' } });
      }
    })().catch((error: unknown) => failRequest(res, error));
  });

  const mcpServer = http.createServer((req, res) => {
    createMcpHandler({
      tasks: tasks.service,
      feeds: feeds.service,
      token: config.mcpAuthToken,
      allowedOrigins: config.mcpAllowedOrigins,
      exposeTaskNotes: config.mcpExposeTaskNotes,
      version,
      onToolCall: (event) => chat.service.recordMcpTool(event),
    })(req, res).catch((error: unknown) => failRequest(res, error));
  });

  let backupTimer: NodeJS.Timeout | undefined;
  const backup = () => {
    try {
      const dir = path.join(config.dataDir, 'backups');
      const latest = fs.existsSync(dir) ? fs.readdirSync(dir).filter((name) => name.startsWith('daily-')).sort().at(-1) : undefined;
      if (latest && Date.now() - fs.statSync(path.join(dir, latest)).mtimeMs < DAY_MS - 60 * 60 * 1000) return;
      const file = backupDatabase(db, config.dataDir, 'daily', config.backupKeep);
      log.info('daily backup written', { file: path.basename(file) });
    } catch (error) {
      log.error('daily backup failed', { error: String(error) });
    }
  };

  const listen = (server: http.Server, port: number) =>
    new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, config.host, () => resolve());
    });

  return {
    db,
    tasks,
    feeds,
    chat,
    api,
    uiServer,
    mcpServer,
    async start() {
      await listen(uiServer, config.port);
      await listen(mcpServer, config.mcpPort);
      if (!config.mcpAuthToken || config.mcpAuthToken.length < MIN_TOKEN_LENGTH) {
        log.warn(`MCP endpoint disabled: MCP_AUTH_TOKEN missing or shorter than ${MIN_TOKEN_LENGTH} characters`);
      }
      feeds.scheduler.start();
      backup();
      backupTimer = setInterval(backup, DAY_MS);
      backupTimer.unref();
      log.info('life-hub started', { version, host: config.host, port: config.port, mcpPort: config.mcpPort });
    },
    async stop() {
      feeds.scheduler.stop();
      if (backupTimer) clearInterval(backupTimer);
      const close = (server: http.Server) =>
        new Promise<void>((resolve) => {
          if (!server.listening) return resolve();
          server.close(() => resolve());
          server.closeAllConnections();
        });
      await Promise.all([close(uiServer), close(mcpServer)]);
      await chat.service.idle();
      db.close();
    },
  };
}
