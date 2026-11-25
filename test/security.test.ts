import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp, type App } from '../src/app.ts';
import { openMemoryDatabase } from '../src/core/db.ts';
import { blockedAddressReason, FetchError, safeFetch } from '../src/modules/feeds/net.ts';
import { htmlToText, safeHttpUrl } from '../src/modules/feeds/sanitize.ts';
import { testConfig } from './helpers.ts';

interface Res {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: string;
}

function request(port: number, options: { method?: string; path: string; headers?: Record<string, string>; body?: string }): Promise<Res> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port, method: options.method ?? 'GET', path: options.path, headers: options.headers },
      (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk: string) => (body += chunk));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }));
      },
    );
    req.on('error', reject);
    req.end(options.body);
  });
}

function port(server: http.Server): number {
  return (server.address() as { port: number }).port;
}

describe('UI/API hardening', () => {
  let app: App;
  let p: number;
  const json = { 'Content-Type': 'application/json' };

  beforeAll(async () => {
    const config = testConfig({ TRUSTED_PROXIES: '127.0.0.1', ALLOWED_HOSTS: 'hub.example,hub.tailnet.example' });
    fs.writeFileSync(path.join(config.webDir, 'index.html'), '<!doctype html><title>Life Hub</title>');
    app = createApp(config, { db: openMemoryDatabase() });
    await app.start();
    p = port(app.uiServer);
  });

  afterAll(async () => {
    await app.stop();
  });

  it('rejects unknown Host headers (DNS rebinding)', async () => {
    expect((await request(p, { path: '/api/v1/health', headers: { Host: 'evil.example' } })).status).toBe(403);
    expect((await request(p, { path: '/', headers: { Host: 'evil.example:3000' } })).status).toBe(403);
    expect((await request(p, { path: '/api/v1/health', headers: { Host: 'hub.example:3000' } })).status).toBe(200);
    expect((await request(p, { path: '/api/v1/health', headers: { Host: 'localhost:3000' } })).status).toBe(200);
  });

  it('sends a strict CSP and no CORS headers', async () => {
    const res = await request(p, { path: '/', headers: { Host: 'hub.example', Origin: 'https://evil.example' } });
    expect(res.status).toBe(200);
    expect(res.headers['content-security-policy']).toContain("default-src 'self'");
    expect(res.headers['content-security-policy']).toContain("img-src 'self' data:");
    expect(res.headers['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
    const api = await request(p, { path: '/api/v1/tasks', headers: { Host: 'hub.example', Origin: 'https://evil.example' } });
    expect(api.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('serves the SPA fallback but 404s missing assets', async () => {
    expect((await request(p, { path: '/aufgaben', headers: { Host: 'hub.example' } })).body).toContain('Life Hub');
    expect((await request(p, { path: '/assets/missing.js', headers: { Host: 'hub.example' } })).status).toBe(404);
    for (const traversal of ['/../../etc/passwd', '/%2e%2e/%2e%2e/etc/passwd', '/..%2f..%2fetc%2fpasswd']) {
      expect((await request(p, { path: traversal, headers: { Host: 'hub.example' } })).body).not.toContain('root:');
    }
  });

  it('rejects mutations without a matching Origin (CSRF)', async () => {
    const body = JSON.stringify({ title: 'x' });
    const base = { method: 'POST', path: '/api/v1/tasks', body };
    expect((await request(p, { ...base, headers: { ...json, Host: 'hub.example' } })).status).toBe(403);
    expect((await request(p, { ...base, headers: { ...json, Host: 'hub.example', Origin: 'http://evil.example' } })).status).toBe(403);
    expect((await request(p, { ...base, headers: { ...json, Host: 'hub.example', Origin: 'https://hub.example' } })).status).toBe(403);
    expect((await request(p, { ...base, headers: { ...json, Host: 'hub.example', Origin: 'http://hub.example' } })).status).toBe(201);
  });

  it('rejects non-JSON writes', async () => {
    const headers = { Host: 'hub.example', Origin: 'http://hub.example' };
    const form = await request(p, {
      method: 'POST',
      path: '/api/v1/tasks',
      headers: { ...headers, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'title=x',
    });
    expect(form.status).toBe(415);
    const plain = await request(p, { method: 'POST', path: '/api/v1/tasks', headers: { ...headers, 'Content-Type': 'text/plain' }, body: '{"title":"x"}' });
    expect(plain.status).toBe(415);
    const broken = await request(p, { method: 'POST', path: '/api/v1/tasks', headers: { ...headers, ...json }, body: '{' });
    expect(broken.status).toBe(400);
  });

  it('honours X-Forwarded-Host/Proto only from trusted proxies', async () => {
    // 127.0.0.1 is trusted in this config: the browser origin is https://hub.tailnet.example.
    const ok = await request(p, {
      method: 'POST',
      path: '/api/v1/tasks',
      headers: {
        ...json,
        Host: '127.0.0.1:3000',
        'X-Forwarded-Host': 'hub.tailnet.example',
        'X-Forwarded-Proto': 'https',
        Origin: 'https://hub.tailnet.example',
      },
      body: JSON.stringify({ title: 'Über Proxy' }),
    });
    expect(ok.status).toBe(201);
    const badHost = await request(p, {
      path: '/api/v1/health',
      headers: { Host: 'hub.example', 'X-Forwarded-Host': 'evil.example' },
    });
    expect(badHost.status).toBe(403);
  });

  it('ignores forwarded headers from untrusted peers', async () => {
    const config = testConfig({ TRUSTED_PROXIES: '192.0.2.10' });
    const other = createApp(config, { db: openMemoryDatabase() });
    await other.start();
    try {
      const res = await request(port(other.uiServer), {
        method: 'POST',
        path: '/api/v1/tasks',
        headers: {
          ...json,
          Host: 'hub.example',
          'X-Forwarded-Host': 'hub.example',
          'X-Forwarded-Proto': 'https',
          Origin: 'https://hub.example',
        },
        body: JSON.stringify({ title: 'x' }),
      });
      expect(res.status).toBe(403); // proto stays http, so the https Origin does not match
    } finally {
      await other.stop();
    }
  });

  it('answers malformed request targets with 400 instead of crashing (UI and MCP port)', async () => {
    for (const server of [app.uiServer, app.mcpServer]) {
      const res = await request(port(server), { path: '//', headers: { Host: 'localhost' } });
      expect(res.status).toBe(400);
    }
    expect((await request(p, { path: '/api/v1/health', headers: { Host: 'hub.example' } })).status).toBe(200);
  });

  it('returns German JSON errors for unknown routes and invalid input', async () => {
    const res = await request(p, { path: '/api/v1/nope', headers: { Host: 'hub.example' } });
    expect(res.status).toBe(404);
    const invalid = await request(p, {
      method: 'POST',
      path: '/api/v1/tasks',
      headers: { ...json, Host: 'hub.example', Origin: 'http://hub.example' },
      body: JSON.stringify({ title: 'x', dueDate: 'morgen' }),
    });
    expect(invalid.status).toBe(400);
    expect(JSON.parse(invalid.body).error.message).toMatch(/JJJJ-MM-TT/);
  });
});

describe('feed content sanitization', () => {
  it('reduces HTML to plain text', () => {
    expect(htmlToText('<p>Hallo <b>Welt</b><script>alert(1)</script><style>p{}</style></p>')).toBe('Hallo Welt');
    expect(htmlToText('&lt;img src=x onerror=alert(1)&gt;Text')).toBe('Text');
    expect(htmlToText('a&nbsp;&amp;&#x41;&#66;')).toBe('a &AB');
    expect(htmlToText('x'.repeat(700)).length).toBe(600);
  });

  it('accepts only http and https links', () => {
    expect(safeHttpUrl('javascript:alert(1)')).toBeNull();
    expect(safeHttpUrl('data:text/html,x')).toBeNull();
    expect(safeHttpUrl(' https://ok.example/a ')).toBe('https://ok.example/a');
    expect(safeHttpUrl('/rel', 'https://base.example/feed')).toBe('https://base.example/rel');
  });
});

describe('SSRF protection', () => {
  const options = { allowPrivate: false, timeoutMs: 2000, maxBytes: 10_000 };
  let server: http.Server;
  let p: number;

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      if (req.url === '/redirect-reserved') {
        res.writeHead(302, { Location: `http://0.0.0.0:${p}/feed` });
        res.end();
      } else if (req.url === '/redirect-loop') {
        res.writeHead(302, { Location: '/redirect-loop' });
        res.end();
      } else if (req.url === '/big') {
        res.end('x'.repeat(20_000));
      } else if (req.url === '/slow') {
        // Slow drip: one byte every 50 ms keeps an idle timeout from ever firing.
        res.writeHead(200);
        const timer = setInterval(() => res.write('x'), 50);
        res.on('close', () => clearInterval(timer));
      } else {
        res.end('<rss/>');
      }
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    p = port(server);
  });

  afterAll(() => {
    server.close();
  });

  it('classifies private, reserved and public addresses', () => {
    for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.5.4', '192.168.1.1', '169.254.169.254', '100.100.100.100', '::1', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1']) {
      expect(blockedAddressReason(ip, false), ip).toBe('private address');
      expect(blockedAddressReason(ip, true), ip).toBeUndefined();
    }
    for (const ip of ['0.0.0.0', '::', '224.0.0.1']) expect(blockedAddressReason(ip, true), ip).toBe('reserved address');
    expect(blockedAddressReason('93.184.215.14', false)).toBeUndefined();
    expect(blockedAddressReason('2606:4700::1', false)).toBeUndefined();
  });

  it('blocks loopback by default, by IP literal and after DNS resolution', async () => {
    await expect(safeFetch(`http://127.0.0.1:${p}/feed`, options)).rejects.toMatchObject({ reason: 'blocked' });
    await expect(safeFetch(`http://localhost:${p}/feed`, options)).rejects.toMatchObject({ reason: 'blocked' });
    await expect(safeFetch(`http://[::ffff:7f00:1]:${p}/feed`, options)).rejects.toBeInstanceOf(FetchError);
  });

  it('allows private targets only with ALLOW_PRIVATE_FEED_URLS', async () => {
    const res = await safeFetch(`http://localhost:${p}/feed`, { ...options, allowPrivate: true });
    expect(res.body).toBe('<rss/>');
  });

  it('checks every redirect hop and limits redirects and size', async () => {
    const allowed = { ...options, allowPrivate: true };
    await expect(safeFetch(`http://127.0.0.1:${p}/redirect-reserved`, allowed)).rejects.toMatchObject({ reason: 'blocked' });
    await expect(safeFetch(`http://127.0.0.1:${p}/redirect-loop`, allowed)).rejects.toMatchObject({ reason: 'redirects' });
    await expect(safeFetch(`http://127.0.0.1:${p}/big`, allowed)).rejects.toMatchObject({ reason: 'too_large' });
    await expect(safeFetch('file:///etc/passwd', allowed)).rejects.toMatchObject({ reason: 'scheme' });
  });

  it('enforces a total deadline, not just an idle timeout', async () => {
    const started = Date.now();
    await expect(safeFetch(`http://127.0.0.1:${p}/slow`, { ...options, allowPrivate: true, timeoutMs: 300 })).rejects.toMatchObject({
      reason: 'timeout',
    });
    expect(Date.now() - started).toBeLessThan(2000);
  });
});
