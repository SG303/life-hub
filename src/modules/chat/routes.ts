import { HttpError, Router, input, reply, streamReply } from '../../core/http.js';
import type { AgentClient } from './agent.js';
import { CHAT_LIMITS, type ChatService, type ContextType, type ThreadPatch } from './service.js';

function threadPatch(body: unknown): ThreadPatch {
  const data = input.object(body);
  const patch: ThreadPatch = {
    title: input.string(data.title, 'Titel', 500),
    pinned: input.boolean(data.pinned, 'Angeheftet'),
    settled: input.boolean(data.settled, 'Erledigt'),
    autoSettle: input.boolean(data.autoSettle, 'Automatisch erledigen'),
  };
  if (data.snoozedUntil === null) patch.snoozedUntil = null;
  else if (data.snoozedUntil !== undefined) patch.snoozedUntil = input.string(data.snoozedUntil, 'Schlummern bis', 40, true);
  return patch;
}

function context(value: unknown): { type: ContextType; id: number } | undefined {
  if (value === undefined || value === null) return undefined;
  const data = input.object(value);
  if (data.type !== 'task' && data.type !== 'feed_item') throw new HttpError(400, 'invalid_field', 'Ungültiger Kontext.');
  return { type: data.type, id: input.id(String(data.id)) };
}

export function chatRoutes(chat: ChatService, agent: AgentClient): Router {
  const threadState = (id: number) => ({ thread: chat.requireThread(id), messages: chat.messages(id) });
  return new Router()
    .get('/status', () => agent.status())
    .get('/context', ({ query }) => {
      const ctx = context({ type: query.get('type'), id: query.get('id') })!;
      return chat.snapshot(ctx.type, ctx.id);
    })
    .get('/threads', () => ({ items: chat.listThreads() }))
    .post('/threads', ({ body }) => {
      const data = input.object(body);
      return reply(201, chat.createThread({ context: context(data.context) }));
    })
    .get('/threads/:id', ({ params }) => threadState(input.id(params.id)))
    .patch('/threads/:id', ({ params, body }) => chat.updateThread(input.id(params.id), threadPatch(body)))
    .delete('/threads/:id', ({ params }) => {
      chat.deleteThread(input.id(params.id));
      return reply(204);
    })
    .get('/threads/:id/stream', ({ params }) => {
      const id = input.id(params.id);
      chat.requireThread(id);
      return streamReply((req, res) => {
        res.writeHead(200, {
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-cache, no-transform',
          Connection: 'keep-alive',
          'X-Accel-Buffering': 'no',
        });
        res.flushHeaders();
        let closed = false;
        let unsubscribe = () => {};
        const keepalive = setInterval(() => {
          if (!res.writableEnded && !res.destroyed) res.write(': keepalive\n\n');
        }, 15_000);
        keepalive.unref();
        const finish = () => {
          if (closed) return;
          closed = true;
          clearInterval(keepalive);
          unsubscribe();
          if (!res.writableEnded) res.end();
        };
        req.on('close', finish);
        unsubscribe = chat.subscribe(id, (event) => {
          if (!res.writableEnded && !res.destroyed) {
            res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
          }
          if (event.type === 'done') finish();
        });
      });
    })
    .post('/threads/:id/messages', async ({ params, body }) => {
      const id = input.id(params.id);
      const data = input.object(body);
      const payload = {
        content: input.string(data.content, 'Nachricht', CHAT_LIMITS.message, true)!,
        context: context(data.context),
      };
      if (input.boolean(data.async, 'Asynchron')) {
        return reply(202, chat.startSend(id, payload));
      }
      await chat.send(id, payload);
      return threadState(id);
    })
    .post('/threads/:id/retry', async ({ params, body }) => {
      const id = input.id(params.id);
      const data = body ? input.object(body) : {};
      if (input.boolean(data.async, 'Asynchron')) {
        return reply(202, chat.startRetry(id));
      }
      await chat.retry(id);
      return threadState(id);
    });
}
