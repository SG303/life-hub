/** Public interface of the feeds module. Other modules import only from here. */
import type { FeedConfig } from '../../config.js';
import type { Db } from '../../core/db.js';
import type { Router } from '../../core/http.js';
import type { Fetcher } from './net.js';
import { feedRoutes } from './routes.js';
import { FeedScheduler } from './scheduler.js';
import { FeedService } from './service.js';

export type {
  BookmarkExpiryDays,
  BookmarkSettings,
  ExpiredBookmarksSummary,
  FeedItem,
  FeedsCockpitSummary,
  FeedSource,
  FeedType,
  ItemFilter,
  ItemStatePatch,
  RefreshResult,
} from './service.js';
export { BOOKMARK_EXPIRY_OPTIONS, DEFAULT_BOOKMARK_EXPIRY_DAYS, FEED_TYPES, FeedService } from './service.js';
export type { Fetcher, FetchOptions, FetchResult } from './net.js';
export { FetchError, safeFetch } from './net.js';

export interface FeedsModule {
  service: FeedService;
  scheduler: FeedScheduler;
  routes: Router;
  /** Summary for the `Heute` cockpit: newest unread items per type plus expired bookmarks. */
  cockpit: { id: string; summary(now: Date): unknown };
}

export function createFeedsModule(db: Db, config: FeedConfig, fetcher?: Fetcher): FeedsModule {
  const service = new FeedService(db, config, fetcher);
  return {
    service,
    scheduler: new FeedScheduler(service, config.refreshIntervalMs),
    routes: feedRoutes(service),
    cockpit: { id: 'feeds', summary: (now) => service.cockpitSummary(5, 5, now) },
  };
}
