import { HttpError, Router, input, reply } from '../../core/http.js';
import { TASK_LIMITS, type TaskInput, type TaskService } from './service.js';

function parseTaskInput(body: unknown, partial: boolean): TaskInput {
  const data = input.object(body);
  const result: TaskInput = {};
  if (!partial || 'title' in data) result.title = input.string(data.title, 'Titel', TASK_LIMITS.title, true);
  if ('note' in data) result.note = input.string(data.note, 'Notiz', TASK_LIMITS.note) ?? null;
  if ('dueDate' in data) result.dueDate = input.string(data.dueDate, 'Fällig', 10) ?? null;
  if ('category' in data) result.category = input.string(data.category, 'Liste', TASK_LIMITS.category) ?? null;
  if ('done' in data) result.done = input.boolean(data.done, 'Erledigt');
  return result;
}

export function taskRoutes(tasks: TaskService): Router {
  return new Router()
    .get('/', ({ query }) => {
      const status = query.get('status') ?? 'all';
      if (!['open', 'done', 'all'].includes(status)) throw new HttpError(400, 'invalid_query', 'Ungültiger Status-Filter.');
      const result = tasks.list({
        status: status as 'open' | 'done' | 'all',
        category: query.get('category') || undefined,
        query: query.get('q')?.slice(0, 200) || undefined,
        limit: input.limit(query.get('limit'), 500, 500),
      });
      return { ...result, today: tasks.today() };
    })
    .get('/categories', () => ({ items: tasks.categories() }))
    .post('/', ({ body }) => reply(201, tasks.create(parseTaskInput(body, false))))
    .get('/:id', ({ params }) => tasks.require(input.id(params.id)))
    .patch('/:id', ({ params, body }) => tasks.update(input.id(params.id), parseTaskInput(body, true)))
    .delete('/:id', ({ params }) => {
      tasks.remove(input.id(params.id));
      return reply(204);
    });
}
