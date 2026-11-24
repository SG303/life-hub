import { HttpError, Router, input, reply } from '../../core/http.js';
import { OPML_MAX_BYTES } from './opml.js';
import { FEED_TYPES, type FeedService, type FeedType } from './service.js';

function feedType(value: unknown): FeedType | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (!FEED_TYPES.includes(value as FeedType)) throw new HttpError(400, 'invalid_field', 'Ungültiger Typ.');
  return value as FeedType;
}

export function feedRoutes(feeds: FeedService): Router {
  return new Router()
    .get('/sources', () => ({ items: feeds.listSources(), refreshing: feeds.isRefreshing }))
    .post('/sources', async ({ body }) => {
      const data = input.object(body);
      const source = await feeds.addSource({
        url: input.string(data.url, 'Adresse', 2000, true)!,
        type: feedType(data.type),
        title: input.string(data.title, 'Titel', 200),
      });
      return reply(201, source);
    })
    .patch('/sources/:id', async ({ params, body }) => {
      const data = input.object(body);
      return feeds.updateSource(input.id(params.id), {
        title: input.string(data.title, 'Titel', 200),
        type: feedType(data.type),
        url: input.string(data.url, 'Adresse', 2000),
      });
    })
    .delete('/sources/:id', ({ params }) => {
      feeds.deleteSource(input.id(params.id));
      return reply(204);
    })
    .post('/opml', ({ body }) => {
      const data = input.object(body);
      const result = feeds.importOpml(input.string(data.opml, 'OPML', OPML_MAX_BYTES, true)!);
      if (result.added > 0) void feeds.refreshAll({ onlyDue: true });
      return result;
    })
    .post('/refresh', () => feeds.refreshAll())
    .get('/items', ({ query }) => {
      const source = query.get('source');
      const offset = Number(query.get('offset') ?? 0);
      return feeds.listItems({
        type: feedType(query.get('type')),
        unread: query.get('unread') === '1',
        bookmarked: query.get('bookmarked') === '1',
        sourceId: source ? input.id(source) : undefined,
        query: query.get('q')?.slice(0, 200) || undefined,
        limit: input.limit(query.get('limit'), 50, 200),
        offset: Number.isInteger(offset) && offset > 0 ? offset : 0,
      });
    })
    .post('/items/mark-read', ({ body }) => ({ updated: feeds.markAllRead(feedType(input.object(body).type)) }))
    .get('/items/:id', ({ params }) => feeds.requireItem(input.id(params.id)))
    .patch('/items/:id', ({ params, body }) => {
      const data = input.object(body);
      return feeds.setItemState(input.id(params.id), {
        read: input.boolean(data.read, 'Gelesen'),
        bookmarked: input.boolean(data.bookmarked, 'Gemerkt'),
      });
    });
}
