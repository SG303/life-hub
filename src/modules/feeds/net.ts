import dns from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import zlib from 'node:zlib';
import { unmapIpv4 } from '../../core/security.js';

export const USER_AGENT = 'life-hub/1.0 (self-hosted feed reader)';

export class FetchError extends Error {
  readonly reason: 'blocked' | 'network' | 'timeout' | 'too_large' | 'redirects' | 'status' | 'scheme';
  readonly status?: number;

  constructor(reason: FetchError['reason'], message: string, status?: number) {
    super(message);
    this.reason = reason;
    this.status = status;
  }
}

export interface FetchOptions {
  allowPrivate: boolean;
  timeoutMs: number;
  maxBytes: number;
  headers?: Record<string, string>;
  maxRedirects?: number;
  /** Optional extra restriction on redirect targets (e.g. YouTube hosts only). */
  allowRedirect?: (url: URL) => boolean;
}

export interface FetchResult {
  status: number;
  url: string;
  headers: http.IncomingHttpHeaders;
  body: string;
}

export type Fetcher = (url: string, options: FetchOptions) => Promise<FetchResult>;

function blockList(entries: [string, number][]): net.BlockList {
  const list = new net.BlockList();
  for (const [address, prefix] of entries) list.addSubnet(address, prefix, net.isIPv6(address) ? 'ipv6' : 'ipv4');
  return list;
}

/** Never reachable: unspecified, multicast, broadcast and reserved ranges. */
const ALWAYS_BLOCKED = blockList([
  ['0.0.0.0', 8],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
  ['::', 128],
  ['ff00::', 8],
]);

/** Private networks: blocked unless `ALLOW_PRIVATE_FEED_URLS=true`. */
const PRIVATE = blockList([
  ['127.0.0.0', 8],
  ['10.0.0.0', 8],
  ['172.16.0.0', 12],
  ['192.168.0.0', 16],
  ['169.254.0.0', 16],
  ['100.64.0.0', 10],
  ['::1', 128],
  ['64:ff9b:1::', 48], // local-use NAT64 (RFC 8215)
  ['fc00::', 7],
  ['fe80::', 10],
]);

/** Well-known NAT64 prefix (RFC 6052): the last 32 bits are an IPv4 address. */
const NAT64 = blockList([['64:ff9b::', 96]]);

/** Returns the IPv4 address embedded in a `64:ff9b::/96` address, otherwise `undefined`. */
function nat64Ipv4(ip: string): string | undefined {
  if (!net.isIPv6(ip) || !NAT64.check(ip, 'ipv6')) return undefined;
  // The URL parser normalises to compressed hex, e.g. `64:ff9b::7f00:1`.
  const host = new URL(`http://[${ip}]`).hostname.slice(1, -1);
  const groups = host.slice(host.indexOf('::') + 2).split(':').filter(Boolean).map((group) => parseInt(group, 16));
  while (groups.length < 2) groups.unshift(0);
  const [high, low] = groups as [number, number];
  return [high >> 8, high & 255, low >> 8, low & 255].join('.');
}

/** Returns a reason if `address` must not be contacted, otherwise `undefined`. */
export function blockedAddressReason(address: string, allowPrivate: boolean): string | undefined {
  const ip = unmapIpv4(address);
  const family = net.isIPv6(ip) ? 'ipv6' : 'ipv4';
  if (!net.isIP(ip)) return 'invalid address';
  const embedded = nat64Ipv4(ip);
  if (embedded) return blockedAddressReason(embedded, allowPrivate);
  if (ALWAYS_BLOCKED.check(ip, family)) return 'reserved address';
  if (!allowPrivate && PRIVATE.check(ip, family)) return 'private address';
  return undefined;
}

type LookupCallback = (err: NodeJS.ErrnoException | null, address: string | dns.LookupAddress[], family?: number) => void;

/** DNS lookup that refuses blocked addresses, so the check applies to the address actually connected to. */
function guardedLookup(allowPrivate: boolean) {
  return (hostname: string, options: dns.LookupOptions, callback: LookupCallback): void => {
    dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
      if (err) return callback(err, []);
      const list = addresses as dns.LookupAddress[];
      const bad = list.find((entry) => blockedAddressReason(entry.address, allowPrivate));
      if (bad || list.length === 0) {
        const error: NodeJS.ErrnoException = new Error(`Blocked address for ${hostname}`);
        error.code = 'EBLOCKED';
        return callback(error, []);
      }
      if (options.all) return callback(null, list);
      callback(null, list[0]!.address, list[0]!.family);
    });
  };
}

function decompress(raw: Buffer, encoding: string | undefined, maxBytes: number): Buffer {
  const options = { maxOutputLength: maxBytes };
  switch ((encoding ?? '').toLowerCase()) {
    case 'gzip':
    case 'x-gzip':
      return zlib.gunzipSync(raw, options);
    case 'deflate':
      return zlib.inflateSync(raw, options);
    case 'br':
      return zlib.brotliDecompressSync(raw, options);
    default:
      return raw;
  }
}

function decodeText(body: Buffer, contentType: string | undefined): string {
  let charset = /charset="?([\w-]+)/i.exec(contentType ?? '')?.[1];
  if (!charset) charset = /<\?xml[^>]*encoding=["']([\w-]+)["']/i.exec(body.subarray(0, 300).toString('latin1'))?.[1];
  try {
    return new TextDecoder(charset ?? 'utf-8').decode(body);
  } catch {
    return new TextDecoder('utf-8').decode(body);
  }
}

function requestOnce(url: URL, options: FetchOptions, deadline: number): Promise<FetchResult> {
  const client = url.protocol === 'https:' ? https : http;
  return new Promise((resolve, reject) => {
    const req = client.request(
      url,
      {
        method: 'GET',
        headers: {
          'User-Agent': USER_AGENT,
          Accept: 'application/rss+xml, application/atom+xml, application/xml;q=0.9, text/xml;q=0.9, */*;q=0.8',
          'Accept-Encoding': 'gzip, deflate, br',
          ...options.headers,
        },
        lookup: guardedLookup(options.allowPrivate) as unknown as typeof dns.lookup,
        agent: false,
      },
      (res) => {
        const chunks: Buffer[] = [];
        let size = 0;
        res.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size > options.maxBytes) {
            reject(new FetchError('too_large', 'Response too large'));
            req.destroy();
            return;
          }
          chunks.push(chunk);
        });
        res.on('end', () => {
          if (size > options.maxBytes) return;
          try {
            const raw = Buffer.concat(chunks);
            const body = decompress(raw, res.headers['content-encoding'], options.maxBytes);
            resolve({
              status: res.statusCode ?? 0,
              url: url.toString(),
              headers: res.headers,
              body: decodeText(body, res.headers['content-type']),
            });
          } catch (error) {
            reject(
              error instanceof RangeError || (error as NodeJS.ErrnoException).code === 'ERR_BUFFER_TOO_LARGE'
                ? new FetchError('too_large', 'Response too large')
                : new FetchError('network', 'Invalid response encoding'),
            );
          }
        });
        res.on('error', (error) => reject(error));
      },
    );
    // Wall-clock deadline (not an idle timeout), so a slow-drip response cannot hold the refresh lock.
    const timer = setTimeout(() => {
      reject(new FetchError('timeout', 'Request timed out'));
      req.destroy();
    }, Math.max(0, deadline - Date.now()));
    req.on('close', () => clearTimeout(timer));
    req.on('error', (error: NodeJS.ErrnoException) => {
      if (error instanceof FetchError) reject(error);
      else if (error.code === 'EBLOCKED') reject(new FetchError('blocked', 'Address not allowed'));
      else reject(new FetchError('network', error.code ?? 'Network error'));
    });
    req.end();
  });
}

const ORIGIN_BOUND_HEADERS = new Set(['cookie', 'authorization', 'if-none-match', 'if-modified-since']);

function withoutOriginBoundHeaders(headers: Record<string, string> | undefined): Record<string, string> | undefined {
  if (!headers) return headers;
  return Object.fromEntries(Object.entries(headers).filter(([name]) => !ORIGIN_BOUND_HEADERS.has(name.toLowerCase())));
}

/**
 * GET with SSRF protection: only `http`/`https`, DNS checked on every hop
 * (private ranges blocked unless `allowPrivate`), bounded redirects, a total
 * timeout across all hops and a response size cap.
 */
export const safeFetch: Fetcher = async (input, options) => {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new FetchError('scheme', 'Invalid URL');
  }
  const deadline = Date.now() + options.timeoutMs;
  const maxRedirects = options.maxRedirects ?? 5;
  let headers = options.headers;
  for (let hop = 0; ; hop++) {
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new FetchError('scheme', 'Only http and https are allowed');
    if (url.username || url.password) throw new FetchError('scheme', 'Credentials in URLs are not allowed');
    const literal = url.hostname.replace(/^\[|\]$/g, '');
    if (net.isIP(literal) && blockedAddressReason(literal, options.allowPrivate)) {
      throw new FetchError('blocked', 'Address not allowed');
    }
    const result = await requestOnce(url, { ...options, headers }, deadline);
    const location = result.headers.location;
    if ([301, 302, 303, 307, 308].includes(result.status) && location) {
      if (hop >= maxRedirects) throw new FetchError('redirects', 'Too many redirects');
      let next: URL;
      try {
        next = new URL(location, url);
      } catch {
        throw new FetchError('redirects', 'Invalid redirect target');
      }
      if (options.allowRedirect && !options.allowRedirect(next)) throw new FetchError('redirects', 'Redirect target not allowed');
      // Cookies and cache validators belong to the origin they were meant for.
      if (next.origin !== url.origin) headers = withoutOriginBoundHeaders(headers);
      url = next;
      continue;
    }
    return result;
  }
};
