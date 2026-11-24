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

  private headers(): Record<string, string> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json', Accept: 'application/json' };
    if (this.config.apiKey) headers.Authorization = `Bearer ${this.config.apiKey}`;
    return headers;
  }

  async complete(messages: AgentMessage[]): Promise<string> {
    if (!this.configured) throw new AgentError('not_configured');
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.config.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify({ model: this.config.model, messages, stream: false }),
        signal: AbortSignal.timeout(this.config.timeoutMs),
        redirect: 'error',
      });
    } catch (error) {
      const name = (error as Error).name;
      throw new AgentError(name === 'TimeoutError' || name === 'AbortError' ? 'timeout' : 'unreachable');
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new AgentError('http', response.status);
    }
    let data: unknown;
    try {
      data = await response.json();
    } catch (error) {
      if ((error as Error).name === 'TimeoutError') throw new AgentError('timeout');
      throw new AgentError('invalid');
    }
    const content = (data as { choices?: { message?: { content?: unknown } }[] })?.choices?.[0]?.message?.content;
    if (typeof content !== 'string' || content.trim() === '') throw new AgentError('invalid');
    this.statusCache = { at: Date.now(), reachable: true };
    return content;
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
