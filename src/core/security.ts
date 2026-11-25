import net from 'node:net';
import type { IncomingMessage, ServerResponse } from 'node:http';

export const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "img-src 'self' data:",
  "connect-src 'self'",
  "style-src 'self'",
  "script-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

export function setSecurityHeaders(res: ServerResponse): void {
  res.setHeader('Content-Security-Policy', CONTENT_SECURITY_POLICY);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
}

/** Builds a matcher for a list of IPs and CIDR ranges (IPv4 and IPv6). */
export function ipMatcher(entries: string[]): (address: string | undefined) => boolean {
  const list = new net.BlockList();
  for (const entry of entries) {
    const invalid = new Error(`Invalid IP or CIDR in TRUSTED_PROXIES: ${entry}`);
    const parts = entry.split('/');
    const [ip, prefix] = parts;
    if (parts.length > 2 || !ip || !net.isIP(ip)) throw invalid;
    const family = net.isIPv6(ip) ? 'ipv6' : 'ipv4';
    if (prefix === undefined) {
      list.addAddress(ip, family);
      continue;
    }
    // Strict prefix: a typo such as `10.0.0.1/` must not silently become `/0` (trust everyone).
    const bits = /^\d{1,3}$/.test(prefix) ? Number(prefix) : NaN;
    if (!(bits >= 0 && bits <= (family === 'ipv6' ? 128 : 32))) throw invalid;
    list.addSubnet(ip, bits, family);
  }
  return (address) => {
    if (!address) return false;
    const plain = unmapIpv4(address);
    return list.check(plain, net.isIPv6(plain) ? 'ipv6' : 'ipv4');
  };
}

/** Converts `::ffff:192.0.2.1` to `192.0.2.1`; other addresses are returned unchanged. */
export function unmapIpv4(address: string): string {
  const match = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address);
  return match ? match[1]! : address;
}

export interface RequestOrigin {
  /** Host header value as the browser sent it (may include a port). */
  host: string;
  /** Host name without port, lower-case, IPv6 without brackets. */
  hostname: string;
  proto: 'http' | 'https';
}

function firstValue(header: string | string[] | undefined): string | undefined {
  const value = Array.isArray(header) ? header[0] : header;
  return value?.split(',')[0]?.trim() || undefined;
}

/**
 * Determines host and scheme the browser used. `X-Forwarded-Host` and
 * `X-Forwarded-Proto` are honoured only when the direct peer is a trusted proxy.
 */
export function requestOrigin(req: IncomingMessage, isTrustedProxy: (address: string | undefined) => boolean): RequestOrigin {
  const trusted = isTrustedProxy(req.socket.remoteAddress);
  const forwardedHost = trusted ? firstValue(req.headers['x-forwarded-host']) : undefined;
  const forwardedProto = trusted ? firstValue(req.headers['x-forwarded-proto'])?.toLowerCase() : undefined;
  const host = (forwardedHost ?? req.headers.host ?? '').toLowerCase();
  const encrypted = 'encrypted' in req.socket && Boolean(req.socket.encrypted);
  const proto = forwardedProto === 'https' || forwardedProto === 'http' ? forwardedProto : encrypted ? 'https' : 'http';
  return { host, hostname: hostnameOf(host), proto };
}

export function hostnameOf(host: string): string {
  if (host.startsWith('[')) return host.slice(1, host.indexOf(']'));
  return host.replace(/:\d+$/, '');
}

const LOOPBACK_NAMES = new Set(['localhost', '127.0.0.1', '::1']);

/**
 * Host allowlist against DNS rebinding. Loopback names are always allowed: a
 * page on another site cannot make the browser send them.
 */
export function isAllowedHost(hostname: string, allowedHosts: string[]): boolean {
  if (!hostname) return false;
  return LOOPBACK_NAMES.has(hostname) || allowedHosts.some((entry) => hostnameOf(entry) === hostname);
}

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export function isMutating(method: string | undefined): boolean {
  return MUTATING.has(method ?? 'GET');
}

/** Same-origin check for state-changing requests (CSRF protection). */
export function isSameOrigin(req: IncomingMessage, origin: RequestOrigin): boolean {
  const header = req.headers.origin;
  if (!header) return false;
  return header.toLowerCase() === `${origin.proto}://${origin.host}`;
}

export function isJsonContentType(req: IncomingMessage): boolean {
  const type = req.headers['content-type']?.split(';')[0]?.trim().toLowerCase();
  return type === 'application/json';
}
