import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';

/** Creates a throwaway self-signed certificate for 127.0.0.1/localhost with openssl. */
export function selfSignedCert(): { key: Buffer; cert: Buffer } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'life-hub-cert-'));
  const key = path.join(dir, 'key.pem');
  const cert = path.join(dir, 'cert.pem');
  execFileSync(
    'openssl',
    ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '2', '-subj', '/CN=life-hub-test', '-addext',
      'subjectAltName=IP:127.0.0.1,DNS:localhost', '-keyout', key, '-out', cert],
    { stdio: 'ignore' },
  );
  const result = { key: fs.readFileSync(key), cert: fs.readFileSync(cert) };
  fs.rmSync(dir, { recursive: true, force: true });
  return result;
}

/**
 * TLS-terminating reverse proxy like Tailscale Serve: forwards to `target`
 * and sets `X-Forwarded-Proto: https` and `X-Forwarded-Host`.
 */
export function createHttpsProxy(target: { host: string; port: number }): https.Server {
  return https.createServer(selfSignedCert(), (req, res) => {
    const upstream = http.request(
      {
        host: target.host,
        port: target.port,
        method: req.method,
        path: req.url,
        headers: {
          ...req.headers,
          'x-forwarded-proto': 'https',
          'x-forwarded-host': req.headers.host ?? '',
          'x-forwarded-for': req.socket.remoteAddress ?? '',
        },
      },
      (upstreamRes) => {
        res.writeHead(upstreamRes.statusCode ?? 502, upstreamRes.headers);
        upstreamRes.pipe(res);
      },
    );
    upstream.on('error', () => {
      if (!res.headersSent) res.writeHead(502);
      res.end('Bad gateway');
    });
    req.pipe(upstream);
  });
}
