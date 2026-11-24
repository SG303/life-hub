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
  ['fc00::', 7],
  ['fe80::', 10],
]);

/** Returns a reason if `address` must not be contacted, otherwise `undefined`. */
export function blockedAddressReason(address: string, allowPrivate: boolean): string | undefined {
  const ip = unmapIpv4(address);
  const family = net.isIPv6(ip) ? 'ipv6' : 'ipv4';
  if (!net.isIP(ip)) return 'invalid address';
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

function requestOnce(url: URL, options: FetchOptions): Promise<FetchResult> {
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
    req.setTimeout(options.timeoutMs, () => req.destroy(new FetchError('timeout', 'Request timed out')));
    req.on('error', (error: NodeJS.ErrnoException) => {
      if (error instanceof FetchError) reject(error);
      else if (error.code === 'EBLOCKED') reject(new FetchError('blocked', 'Address not allowed'));
      else reject(new FetchError('network', error.code ?? 'Network error'));
    });
    req.end();
  });
}

/**
 * GET with SSRF protection: only `http`/`https`, DNS checked on every hop
 * (private ranges blocked unless `allowPrivate`), bounded redirects, timeout
 * and response size cap.
 */
export const safeFetch: Fetcher = async (input, options) => {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new FetchError('scheme', 'Invalid URL');
  }
  const maxRedirects = options.maxRedirects ?? 5;
  for (let hop = 0; ; hop++) {
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new FetchError('scheme', 'Only http and https are allowed');
    if (url.username || url.password) throw new FetchError('scheme', 'Credentials in URLs are not allowed');
    const literal = url.hostname.replace(/^\[|\]$/g, '');
    if (net.isIP(literal) && blockedAddressReason(literal, options.allowPrivate)) {
      throw new FetchError('blocked', 'Address not allowed');
    }
    const result = await requestOnce(url, options);
    const location = result.headers.location;
    if ([301, 302, 303, 307, 308].includes(result.status) && location) {
      if (hop >= maxRedirects) throw new FetchError('redirects', 'Too many redirects');
      url = new URL(location, url);
      continue;
    }
    return result;
  }
};
