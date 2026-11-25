import type { AgentConfig } from '../../config.js';

export interface AgentMessage {
  role: 'user' | 'assistant';
  content: string;
}

export class AgentError extends Error {
  readonly reason: 'not_configured' | 'timeout' | 'unreachable' | 'http' | 'invalid';
  readonly status?: number;

  constructor(reason: AgentError['reason'], status?: number) {
    super(reason);
    this.reason = reason;
    this.status = status;
  }

  /** German message shown in the chat. Never includes upstream bodies or secrets. */
  get userMessage(): string {
    switch (this.reason) {
      case 'not_configured':
        return 'Kein Agent konfiguriert. Bitte AGENT_BASE_URL und AGENT_MODEL setzen.';
      case 'timeout':
        return 'Der Agent hat nicht rechtzeitig geantwortet.';
      case 'unreachable':
        return 'Der Agent ist nicht erreichbar.';
      case 'http':
        return `Der Agent hat einen Fehler gemeldet (HTTP ${this.status ?? '?'}).`;
      default:
        return 'Die Antwort des Agenten war ungültig.';
    }
  }
}

export type FetchLike = typeof fetch;

export interface AgentStreamCallbacks {
  onDelta: (text: string) => void;
  onTool?: (name: string) => void;
}

interface SseChunk {
  error?: unknown;
  choices?: {
    delta?: {
      content?: unknown;
      tool_calls?: { index?: number; id?: string; function?: { name?: unknown } }[];
    };
    message?: { content?: unknown };
  }[];
}

const STREAM_FALLBACK_STATUSES = new Set([400, 422, 501]);

function isAbortLike(error: unknown, signal: AbortSignal): boolean {
  if (signal.aborted) return true;
  const name = (error as Error | undefined)?.name;
  return name === 'TimeoutError' || name === 'AbortError';
}

/**
 * Thin client for any OpenAI-compatible `/chat/completions` endpoint.
 * `AGENT_BASE_URL` includes the API prefix, e.g. `http://agent.example:8642/v1`.
 */
export class AgentClient {
  private readonly config: AgentConfig;
  private readonly fetchImpl: FetchLike;
  private statusCache: { at: number; reachable: boolean } | undefined;

  constructor(config: AgentConfig, fetchImpl: FetchLike = fetch) {
    this.config = config;
    this.fetchImpl = fetchImpl;
  }

  get configured(): boolean {
    return Boolean(this.config.baseUrl && this.config.model);
  }

  get model(): string | null {
    return this.config.model ?? null;
  }

  private headers(accept = 'application/json'): Record<string, string> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json', Accept: accept };
    if (this.config.apiKey) headers.Authorization = `Bearer ${this.config.apiKey}`;
    return headers;
  }

  private async postCompletion(messages: AgentMessage[], stream: boolean, signal: AbortSignal): Promise<Response> {
    try {
      return await this.fetchImpl(`${this.config.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: this.headers(stream ? 'text/event-stream, application/json' : 'application/json'),
        body: JSON.stringify({ model: this.config.model, messages, stream }),
        signal,
        redirect: 'error',
      });
    } catch (error) {
      throw new AgentError(isAbortLike(error, signal) ? 'timeout' : 'unreachable');
    }
  }

  private async parseJsonCompletion(response: Response, signal: AbortSignal, callbacks: AgentStreamCallbacks): Promise<string> {
    let data: unknown;
    try {
      data = await response.json();
    } catch (error) {
      if (isAbortLike(error, signal)) throw new AgentError('timeout');
      throw new AgentError('invalid');
    }
    const content = (data as SseChunk)?.choices?.[0]?.message?.content;
    if (typeof content !== 'string' || content.trim() === '') throw new AgentError('invalid');
    callbacks.onDelta(content);
    this.statusCache = { at: Date.now(), reachable: true };
    return content;
  }

  private async readSseCompletion(response: Response, signal: AbortSignal, callbacks: AgentStreamCallbacks): Promise<string> {
    const body = response.body;
    if (!body) throw new AgentError('invalid');
    const reader = body.getReader();
    const decoder = new TextDecoder();
    const seenTools = new Set<string>();
    let buffer = '';
    let content = '';
    let done = false;

    const handlePayload = (raw: string) => {
      const payload = raw.trim();
      if (!payload) return;
      if (payload === '[DONE]') {
        done = true;
        return;
      }
      let chunk: SseChunk;
      try {
        chunk = JSON.parse(payload) as SseChunk;
      } catch {
        return;
      }
      if (chunk.error) throw new AgentError('http', 502);
      const choice = chunk.choices?.[0];
      const toolCalls = choice?.delta?.tool_calls;
      if (Array.isArray(toolCalls)) {
        for (const call of toolCalls) {
          const name = typeof call?.function?.name === 'string' ? call.function.name.trim() : '';
          if (!name) continue;
          const key = call.id ?? (call.index !== undefined ? `idx:${call.index}:${name}` : name);
          if (!seenTools.has(key)) {
            seenTools.add(key);
            callbacks.onTool?.(name);
          }
        }
      }
      const delta = choice?.delta?.content ?? choice?.message?.content;
      if (typeof delta === 'string' && delta.length > 0) {
        content += delta;
        callbacks.onDelta(delta);
      }
    };

    const drainLines = (flush: boolean) => {
      const lines = buffer.split(/\r?\n/);
      buffer = flush ? '' : (lines.pop() ?? '');
      for (const line of lines) {
        if (done) return;
        if (!line.startsWith('data:')) continue;
        handlePayload(line.slice(5));
      }
    };

    const onAbort = () => {
      void reader.cancel().catch(() => {});
    };
    signal.addEventListener('abort', onAbort, { once: true });

    try {
      if (signal.aborted) throw new AgentError('timeout');
      while (!done) {
        const { value, done: eof } = await reader.read();
        if (signal.aborted) throw new AgentError('timeout');
        if (eof) break;
        buffer += decoder.decode(value, { stream: true });
        drainLines(false);
      }
      if (!done) {
        buffer += decoder.decode();
        drainLines(true);
      }
    } catch (error) {
      await reader.cancel().catch(() => {});
      if (error instanceof AgentError) throw error;
      throw new AgentError(isAbortLike(error, signal) ? 'timeout' : 'unreachable');
    } finally {
      signal.removeEventListener('abort', onAbort);
    }

    if (done) await reader.cancel().catch(() => {});
    if (content.trim() === '') throw new AgentError('invalid');
    this.statusCache = { at: Date.now(), reachable: true };
    return content;
  }

  /**
   * Streams a completion over SSE, falling back automatically when the
   * configured agent ignores or rejects `stream: true`.
   */
  async stream(messages: AgentMessage[], callbacks: AgentStreamCallbacks): Promise<string> {
    if (!this.configured) throw new AgentError('not_configured');
    const signal = AbortSignal.timeout(this.config.timeoutMs);
    let response = await this.postCompletion(messages, true, signal);
    if (!response.ok) {
      const status = response.status;
      await response.body?.cancel();
      if (STREAM_FALLBACK_STATUSES.has(status)) {
        response = await this.postCompletion(messages, false, signal);
        if (!response.ok) {
          await response.body?.cancel();
          throw new AgentError('http', response.status);
        }
      } else {
        throw new AgentError('http', status);
      }
    }
    const contentType = (response.headers.get('content-type') ?? '').toLowerCase();
    if (contentType.includes('text/event-stream')) {
      return this.readSseCompletion(response, signal, callbacks);
    }
    return this.parseJsonCompletion(response, signal, callbacks);
  }

  async complete(messages: AgentMessage[]): Promise<string> {
    return this.stream(messages, { onDelta: () => {} });
  }

  /** Non-secret status for the UI: configured model and whether `/models` answers. Cached for 30 s. */
  async status(): Promise<{ configured: boolean; model: string | null; reachable: boolean | null }> {
    if (!this.configured) return { configured: false, model: this.model, reachable: null };
    if (!this.statusCache || Date.now() - this.statusCache.at > 30_000) {
      let reachable: boolean;
      try {
        const response = await this.fetchImpl(`${this.config.baseUrl}/models`, {
          headers: this.headers(),
          signal: AbortSignal.timeout(3000),
          redirect: 'error',
        });
        await response.body?.cancel();
        reachable = response.ok;
      } catch {
        reachable = false;
      }
      this.statusCache = { at: Date.now(), reachable };
    }
    return { configured: true, model: this.model, reachable: this.statusCache.reachable };
  }

  /** Clears the cached reachability, e.g. after a failed turn. */
  markUnreachable(): void {
    this.statusCache = { at: Date.now(), reachable: false };
  }
}
