import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadConfig, type Config } from '../src/config.ts';
import type { FetchResult, Fetcher } from '../src/modules/feeds/index.ts';

export function testConfig(env: Record<string, string> = {}): Config {
  return loadConfig({
    HOST: '127.0.0.1',
    PORT: '0',
    MCP_PORT: '0',
    DATA_DIR: tempDir(),
    WEB_DIR: tempDir(),
    TZ: 'Europe/Zurich',
    ALLOWED_HOSTS: 'hub.example',
    MCP_AUTH_TOKEN: 'test-token-0123456789abcdefghijklmnop',
    YOUTUBE_BASE_URL: 'https://www.youtube.com',
    ...env,
  });
}

export function tempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'life-hub-test-'));
}

export type Route = string | { status?: number; body?: string; headers?: Record<string, string>; url?: string };

/** In-memory fetcher: maps exact URLs to bodies or responses; unknown URLs return 404. */
export function fakeFetcher(routes: Record<string, Route | (() => Route)>): Fetcher & { calls: string[] } {
  const calls: string[] = [];
  const fetcher = (async (url: string) => {
    calls.push(url);
    const entry = routes[url];
    const route = typeof entry === 'function' ? entry() : entry;
    if (route === undefined) return { status: 404, url, headers: {}, body: '' } satisfies FetchResult;
    if (typeof route === 'string') return { status: 200, url, headers: {}, body: route } satisfies FetchResult;
    return { status: route.status ?? 200, url: route.url ?? url, headers: route.headers ?? {}, body: route.body ?? '' };
  }) as unknown as Fetcher & { calls: string[] };
  fetcher.calls = calls;
  return fetcher;
}
