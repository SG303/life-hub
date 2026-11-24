import type { IncomingMessage, ServerResponse } from 'node:http';

/** An error with an HTTP status and a stable machine-readable code. */
export class HttpError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export interface ApiRequest {
  method: string;
  path: string;
  params: Record<string, string>;
  query: URLSearchParams;
  body: unknown;
}

export interface ApiReply {
  readonly status: number;
  readonly body?: unknown;
  readonly isReply: true;
}

/** Return value of a handler: a JSON body (status 200) or an explicit `reply()`. */
export type ApiHandler = (req: ApiRequest) => unknown;

export function reply(status: number, body?: unknown): ApiReply {
  return { status, body, isReply: true };
}

function isReply(value: unknown): value is ApiReply {
  return typeof value === 'object' && value !== null && (value as ApiReply).isReply === true;
}

interface Route {
  method: string;
  parts: string[];
  handler: ApiHandler;
}

/** Tiny path router: `/tasks/:id` style patterns, exact segment matching. */
export class Router {
  private readonly routes: Route[] = [];

  add(method: string, pattern: string, handler: ApiHandler): this {
    this.routes.push({ method, parts: pattern.split('/').filter(Boolean), handler });
    return this;
  }

  get(pattern: string, handler: ApiHandler): this {
    return this.add('GET', pattern, handler);
  }

  post(pattern: string, handler: ApiHandler): this {
    return this.add('POST', pattern, handler);
  }

  patch(pattern: string, handler: ApiHandler): this {
    return this.add('PATCH', pattern, handler);
  }

  delete(pattern: string, handler: ApiHandler): this {
    return this.add('DELETE', pattern, handler);
  }

  /** Mounts all routes of `other` below `prefix`. */
  mount(prefix: string, other: Router): this {
    const head = prefix.split('/').filter(Boolean);
    for (const route of other.routes) this.routes.push({ ...route, parts: [...head, ...route.parts] });
    return this;
  }

  match(method: string, path: string): { handler: ApiHandler; params: Record<string, string> } | 'method' | undefined {
    const segments = path.split('/').filter(Boolean);
    let pathMatched = false;
    for (const route of this.routes) {
      const params = matchParts(route.parts, segments);
      if (!params) continue;
      pathMatched = true;
      if (route.method === method) return { handler: route.handler, params };
    }
    return pathMatched ? 'method' : undefined;
  }
}

function matchParts(parts: string[], segments: string[]): Record<string, string> | undefined {
  if (parts.length !== segments.length) return undefined;
  const params: Record<string, string> = {};
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]!;
    const segment = segments[i]!;
    if (part.startsWith(':')) {
      try {
        params[part.slice(1)] = decodeURIComponent(segment);
      } catch {
        return undefined;
      }
    } else if (part !== segment) {
      return undefined;
    }
  }
  return params;
}

export function sendJson(res: ServerResponse, status: number, body?: unknown): void {
  if (body === undefined) {
    res.writeHead(status, { 'Cache-Control': 'no-store' });
    res.end();
    return;
  }
  const text = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(text),
    'Cache-Control': 'no-store',
  });
  res.end(text);
}

export async function readBody(req: IncomingMessage, limit: number): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > limit) throw new HttpError(413, 'payload_too_large', 'Request body too large');
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

export function parseJson(text: string): unknown {
  if (text.trim() === '') return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError(400, 'invalid_json', 'Request body is not valid JSON');
  }
}

/** Dispatches an API request to `router` and writes the JSON response. */
export async function handleApi(
  router: Router,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  body: unknown,
): Promise<void> {
  const method = req.method ?? 'GET';
  try {
    const match = router.match(method, url.pathname);
    if (match === undefined) throw new HttpError(404, 'not_found', 'Not found');
    if (match === 'method') throw new HttpError(405, 'method_not_allowed', 'Method not allowed');
    const result = await match.handler({ method, path: url.pathname, params: match.params, query: url.searchParams, body });
    if (isReply(result)) sendJson(res, result.status, result.body);
    else sendJson(res, 200, result);
  } catch (error) {
    if (error instanceof HttpError) {
      sendJson(res, error.status, { error: { code: error.code, message: error.message } });
    } else {
      throw error;
    }
  }
}

/** Input validation helpers: throw a 400 `HttpError` with a German message. */
export const input = {
  object(value: unknown): Record<string, unknown> {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      throw new HttpError(400, 'invalid_body', 'Ungültige Anfrage.');
    }
    return value as Record<string, unknown>;
  },
  id(value: string | undefined): number {
    const id = Number(value);
    if (!Number.isSafeInteger(id) || id <= 0) throw new HttpError(400, 'invalid_id', 'Ungültige ID.');
    return id;
  },
  string(value: unknown, field: string, max: number, required = false): string | undefined {
    if (value === undefined || value === null || value === '') {
      if (required) throw new HttpError(400, 'invalid_field', `Feld «${field}» fehlt.`);
      return undefined;
    }
    if (typeof value !== 'string') throw new HttpError(400, 'invalid_field', `Feld «${field}» ist ungültig.`);
    const trimmed = value.trim();
    if (required && trimmed === '') throw new HttpError(400, 'invalid_field', `Feld «${field}» fehlt.`);
    if (trimmed.length > max) throw new HttpError(400, 'invalid_field', `Feld «${field}» ist zu lang (max. ${max} Zeichen).`);
    return trimmed;
  },
  boolean(value: unknown, field: string): boolean | undefined {
    if (value === undefined) return undefined;
    if (typeof value !== 'boolean') throw new HttpError(400, 'invalid_field', `Feld «${field}» ist ungültig.`);
    return value;
  },
  limit(value: string | null, fallback: number, max: number): number {
    if (value === null || value === '') return fallback;
    const n = Number(value);
    if (!Number.isInteger(n) || n < 1) throw new HttpError(400, 'invalid_query', 'Ungültiger Parameter «limit».');
    return Math.min(n, max);
  },
};
