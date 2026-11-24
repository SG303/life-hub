import http from 'node:http';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { openMemoryDatabase } from '../src/core/db.ts';
import { createMcpHandler, tokenMatches } from '../src/mcp/server.ts';
import { FeedService } from '../src/modules/feeds/index.ts';
import { TaskService } from '../src/modules/tasks/index.ts';
import { newsRss } from './fixtures/feeds.ts';
import { fakeFetcher, testConfig } from './helpers.ts';

const TOKEN = 'mcp-test-token-0123456789abcdefghij';

async function startMcp(token: string | undefined, tasks: TaskService, feeds: FeedService, exposeTaskNotes = true) {
  const handler = createMcpHandler({ tasks, feeds, token, allowedOrigins: ['https://agent.example'], exposeTaskNotes, version: 'test' });
  const server = http.createServer((req, res) => void handler(req, res));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}/mcp`;
  return { server, url };
}

const initialize = JSON.stringify({
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } },
});

function post(url: string, headers: Record<string, string>) {
  return fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', ...headers },
    body: initialize,
  });
}

async function connect(url: string, token = TOKEN): Promise<Client> {
  const client = new Client({ name: 'life-hub-test', version: '1.0.0' });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(url), { requestInit: { headers: { Authorization: `Bearer ${token}` } } }),
  );
  return client;
}

function parse(result: unknown): Record<string, unknown> {
  const content = (result as { content: { type: string; text: string }[] }).content;
  return JSON.parse(content[0]!.text) as Record<string, unknown>;
}

describe('MCP endpoint', () => {
  const tasks = new TaskService(openMemoryDatabase(), 'Europe/Zurich');
  let feeds: FeedService;
  let server: http.Server;
  let url: string;

  beforeAll(async () => {
    feeds = new FeedService(openMemoryDatabase(), testConfig().feeds, fakeFetcher({ 'https://news.example/rss': newsRss(12) }));
    await feeds.addSource({ url: 'https://news.example/rss' });
    for (let i = 1; i <= 25; i++) tasks.create({ title: `Aufgabe ${i}`, note: `Notiz ${i}`, category: i % 2 ? 'Ungerade' : 'Gerade' });
    tasks.create({ title: 'Velo flicken', note: 'Schlauch kaufen' });
    ({ server, url } = await startMcp(TOKEN, tasks, feeds));
  });

  afterAll(() => {
    server.close();
  });

  it('fails closed with 503 when the token is unset or too short', async () => {
    for (const token of [undefined, 'short-token']) {
      const { server: s, url: u } = await startMcp(token, tasks, feeds);
      expect((await post(u, { Authorization: `Bearer ${token ?? 'x'}` })).status).toBe(503);
      s.close();
    }
  });

  it('rejects missing and invalid bearer tokens', async () => {
    const missing = await post(url, {});
    expect(missing.status).toBe(401);
    expect(missing.headers.get('www-authenticate')).toMatch(/Bearer/);
    expect((await post(url, { Authorization: 'Bearer wrong-token-0123456789abcdefghijkl' })).status).toBe(403);
    expect((await post(url, { Authorization: `Basic ${TOKEN}` })).status).toBe(401);
    await expect(connect(url, 'wrong-token-0123456789abcdefghijkl')).rejects.toThrow();
  });

  it('rejects foreign Origin headers but allows configured ones', async () => {
    expect((await post(url, { Authorization: `Bearer ${TOKEN}`, Origin: 'https://evil.example' })).status).toBe(403);
    expect((await post(url, { Authorization: `Bearer ${TOKEN}`, Origin: 'https://agent.example' })).status).toBe(200);
  });

  it('compares tokens in constant time over hashes', () => {
    expect(tokenMatches(TOKEN, TOKEN)).toBe(true);
    expect(tokenMatches(TOKEN, TOKEN.slice(0, -1))).toBe(false);
  });

  it('lists only the read-only tools via the official SDK client', async () => {
    const client = await connect(url);
    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name).sort()).toEqual(['get_feed_item', 'get_task', 'list_feed_items', 'list_tasks', 'search']);
    for (const tool of tools) expect(tool.annotations?.readOnlyHint, tool.name).toBe(true);
    await client.close();
  });

  it('paginates tasks and feed items and returns seeded data', async () => {
    const client = await connect(url);
    const first = parse(await client.callTool({ name: 'list_tasks', arguments: { limit: 10 } }));
    expect(first.total).toBe(26);
    expect((first.items as unknown[]).length).toBe(10);
    const second = parse(await client.callTool({ name: 'list_tasks', arguments: { limit: 10, cursor: first.nextCursor } }));
    const third = parse(await client.callTool({ name: 'list_tasks', arguments: { limit: 10, cursor: second.nextCursor } }));
    expect((third.items as unknown[]).length).toBe(6);
    expect(third.nextCursor).toBeNull();
    const ids = [first, second, third].flatMap((page) => (page.items as { id: number }[]).map((t) => t.id));
    expect(new Set(ids).size).toBe(26);

    const items = parse(await client.callTool({ name: 'list_feed_items', arguments: { limit: 5, unread: true } }));
    expect(items.total).toBe(10);
    expect(items.notice).toMatch(/untrusted/);
    const one = parse(await client.callTool({ name: 'get_feed_item', arguments: { id: (items.items as { id: number }[])[0]!.id } }));
    expect((one.item as { untrustedExternalContent: boolean }).untrustedExternalContent).toBe(true);

    const task = parse(await client.callTool({ name: 'get_task', arguments: { id: 26 } }));
    expect(task).toMatchObject({ title: 'Velo flicken', note: 'Schlauch kaufen' });
    const missing = await client.callTool({ name: 'get_task', arguments: { id: 999 } });
    expect(missing.isError).toBe(true);

    const tooBig = await client.callTool({ name: 'list_tasks', arguments: { limit: 500 } });
    expect(tooBig.isError).toBe(true);
    await client.close();
  });

  it('searches tasks and feed items', async () => {
    const client = await connect(url);
    const result = parse(await client.callTool({ name: 'search', arguments: { query: 'Schlauch' } }));
    expect((result.tasks as { items: { title: string }[] }).items.map((t) => t.title)).toEqual(['Velo flicken']);
    const feedHits = parse(await client.callTool({ name: 'search', arguments: { query: 'Meldung 3' } }));
    expect((feedHits.feedItems as { total: number }).total).toBe(1);
    await client.close();
  });

  it('can hide task notes', async () => {
    const { server: s, url: u } = await startMcp(TOKEN, tasks, feeds, false);
    const client = await connect(u);
    const task = parse(await client.callTool({ name: 'get_task', arguments: { id: 26 } }));
    expect(task.note).toBeUndefined();
    await client.close();
    s.close();
  });

  it('rejects GET (stateless, POST only)', async () => {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${TOKEN}`, Accept: 'text/event-stream' } });
    expect(res.status).toBe(405);
  });
});
