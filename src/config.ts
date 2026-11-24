import path from 'node:path';

/** Runtime configuration, read once from environment variables. */
export interface Config {
  host: string;
  port: number;
  mcpPort: number;
  dataDir: string;
  webDir: string;
  timeZone: string;
  allowedHosts: string[];
  trustedProxies: string[];
  mcpAuthToken: string | undefined;
  mcpAllowedOrigins: string[];
  mcpExposeTaskNotes: boolean;
  agent: AgentConfig;
  feeds: FeedConfig;
  backupKeep: number;
}

export interface AgentConfig {
  baseUrl: string | undefined;
  apiKey: string | undefined;
  model: string | undefined;
  timeoutMs: number;
  maxHistoryMessages: number;
  maxHistoryChars: number;
}

export interface FeedConfig {
  refreshIntervalMs: number;
  allowPrivateUrls: boolean;
  youtubeBaseUrl: string;
  fetchTimeoutMs: number;
  maxBytes: number;
  retentionDays: number;
  firstSubscribeUnread: number;
}

type Env = Record<string, string | undefined>;

function list(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function int(env: Env, key: string, fallback: number, min = 0): number {
  const raw = env[key];
  if (raw === undefined || raw.trim() === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min) {
    throw new Error(`${key} must be an integer >= ${min}`);
  }
  return value;
}

function bool(env: Env, key: string, fallback: boolean): boolean {
  const raw = env[key]?.trim().toLowerCase();
  if (raw === undefined || raw === '') return fallback;
  if (['1', 'true', 'yes', 'on'].includes(raw)) return true;
  if (['0', 'false', 'no', 'off'].includes(raw)) return false;
  throw new Error(`${key} must be true or false`);
}

function optional(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export function loadConfig(env: Env = process.env): Config {
  const timeZone = optional(env.TZ) ?? 'Europe/Zurich';
  // Throws a RangeError for unknown time zones, so misconfiguration fails at startup.
  new Intl.DateTimeFormat('en-CA', { timeZone });

  return {
    host: optional(env.HOST) ?? '0.0.0.0',
    port: int(env, 'PORT', 3000, 0),
    mcpPort: int(env, 'MCP_PORT', 3001, 0),
    dataDir: path.resolve(optional(env.DATA_DIR) ?? 'data'),
    webDir: path.resolve(optional(env.WEB_DIR) ?? 'dist/web'),
    timeZone,
    allowedHosts: list(env.ALLOWED_HOSTS).map((host) => host.toLowerCase()),
    trustedProxies: list(env.TRUSTED_PROXIES),
    mcpAuthToken: optional(env.MCP_AUTH_TOKEN),
    mcpAllowedOrigins: list(env.MCP_ALLOWED_ORIGINS),
    mcpExposeTaskNotes: bool(env, 'MCP_EXPOSE_TASK_NOTES', true),
    agent: {
      baseUrl: optional(env.AGENT_BASE_URL)?.replace(/\/+$/, ''),
      apiKey: optional(env.AGENT_API_KEY),
      model: optional(env.AGENT_MODEL),
      timeoutMs: int(env, 'AGENT_TIMEOUT_MS', 120_000, 1),
      maxHistoryMessages: int(env, 'AGENT_MAX_HISTORY_MESSAGES', 20, 1),
      maxHistoryChars: int(env, 'AGENT_MAX_HISTORY_CHARS', 24_000, 1000),
    },
    feeds: {
      refreshIntervalMs: int(env, 'FEED_REFRESH_INTERVAL_MS', 30 * 60_000, 1000),
      allowPrivateUrls: bool(env, 'ALLOW_PRIVATE_FEED_URLS', false),
      youtubeBaseUrl: (optional(env.YOUTUBE_BASE_URL) ?? 'https://www.youtube.com').replace(/\/+$/, ''),
      fetchTimeoutMs: int(env, 'FEED_FETCH_TIMEOUT_MS', 15_000, 100),
      maxBytes: int(env, 'FEED_MAX_BYTES', 5 * 1024 * 1024, 1024),
      retentionDays: int(env, 'FEED_RETENTION_DAYS', 30, 1),
      firstSubscribeUnread: 10,
    },
    backupKeep: int(env, 'BACKUP_KEEP', 7, 1),
  };
}
