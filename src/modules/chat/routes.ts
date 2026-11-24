import { HttpError, Router, input, reply } from '../../core/http.js';
import type { AgentClient } from './agent.js';
import { CHAT_LIMITS, type ChatService, type ContextType } from './service.js';

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
    .delete('/threads/:id', ({ params }) => {
      chat.deleteThread(input.id(params.id));
      return reply(204);
    })
    .post('/threads/:id/messages', async ({ params, body }) => {
      const id = input.id(params.id);
      const data = input.object(body);
      await chat.send(id, {
        content: input.string(data.content, 'Nachricht', CHAT_LIMITS.message, true)!,
        context: context(data.context),
      });
      return threadState(id);
    })
    .post('/threads/:id/retry', async ({ params }) => {
      const id = input.id(params.id);
      await chat.retry(id);
      return threadState(id);
    });
}
