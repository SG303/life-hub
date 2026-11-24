import type { FeedConfig } from '../../config.js';
import { transaction, type Db } from '../../core/db.js';
import { HttpError } from '../../core/http.js';
import { log } from '../../core/log.js';
import { nowIso } from '../../core/time.js';
import { FetchError, safeFetch, type FetchOptions, type Fetcher } from './net.js';
import { parseOpml } from './opml.js';
import { dedupKey, FeedParseError, parseFeed, type ParsedFeed, type ParsedItem } from './parser.js';
import { safeHttpUrl, truncate } from './sanitize.js';
import { isYouTubeUrl, resolveYouTubeFeed, YouTubeResolveError } from './youtube.js';

export const FEED_TYPES = ['news', 'video', 'podcast'] as const;
export type FeedType = (typeof FEED_TYPES)[number];

export interface FeedSource {
  id: number;
  title: string;
  url: string;
  siteUrl: string | null;
  type: FeedType;
  lastFetchedAt: string | null;
  lastError: string | null;
  createdAt: string;
  itemCount: number;
  unreadCount: number;
}

export interface FeedItem {
  id: number;
  sourceId: number;
  sourceTitle: string;
  type: FeedType;
  title: string;
  url: string | null;
  summary: string;
  publishedAt: string | null;
  fetchedAt: string;
  read: boolean;
  bookmarked: boolean;
}

export interface ItemFilter {
  type?: FeedType;
  unread?: boolean;
  bookmarked?: boolean;
  sourceId?: number;
  query?: string;
  limit?: number;
  offset?: number;
}

export interface RefreshResult {
  refreshed: number;
  failed: number;
  newItems: number;
}

export interface OpmlImportResult {
  added: number;
  skipped: number;
  invalid: number;
}

interface SourceRow {
  id: number;
  title: string;
  url: string;
  site_url: string | null;
  type: FeedType;
  type_auto: number;
  etag: string | null;
  last_modified: string | null;
  last_fetched_at: string | null;
  last_attempt_at: string | null;
  last_error: string | null;
  created_at: string;
  item_count?: number;
  unread_count?: number;
}

interface ItemRow {
  id: number;
  source_id: number;
  source_title: string;
  type: FeedType;
  title: string;
  url: string | null;
  summary: string;
  published_at: string | null;
  fetched_at: string;
  is_read: number;
  is_bookmarked: number;
}

function toSource(row: SourceRow): FeedSource {
  return {
    id: row.id,
    title: row.title,
    url: row.url,
    siteUrl: row.site_url,
    type: row.type,
    lastFetchedAt: row.last_fetched_at,
    lastError: row.last_error,
    createdAt: row.created_at,
    itemCount: row.item_count ?? 0,
    unreadCount: row.unread_count ?? 0,
  };
}

function toItem(row: ItemRow): FeedItem {
  return {
    id: row.id,
    sourceId: row.source_id,
    sourceTitle: row.source_title,
    type: row.type,
    title: row.title,
    url: row.url,
    summary: row.summary,
    publishedAt: row.published_at,
    fetchedAt: row.fetched_at,
    read: row.is_read === 1,
    bookmarked: row.is_bookmarked === 1,
  };
}

const ITEM_SELECT = `
  SELECT i.id, i.source_id, s.title AS source_title, s.type, i.title, i.url, i.summary,
         i.published_at, i.fetched_at, i.is_read, i.is_bookmarked
  FROM feed_items i JOIN feed_sources s ON s.id = i.source_id`;

const SOURCE_SELECT = `
  SELECT s.*, COUNT(i.id) AS item_count, COALESCE(SUM(i.is_read = 0), 0) AS unread_count
  FROM feed_sources s LEFT JOIN feed_items i ON i.source_id = s.id`;

/** Tombstones of pruned items are kept while upstream still lists them, plus this grace period. */
const TOMBSTONE_GRACE_DAYS = 180;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Maps fetch and parse failures to a short German message (safe to store and show). */
export function describeFeedError(error: unknown): string {
  if (error instanceof YouTubeResolveError) return error.message;
  if (error instanceof FeedParseError) return 'Kein gültiger RSS- oder Atom-Feed.';
  if (error instanceof FetchError) {
    switch (error.reason) {
      case 'blocked':
        return 'Adresse nicht erlaubt (privates oder reserviertes Netz).';
      case 'timeout':
        return 'Zeitüberschreitung beim Abrufen.';
      case 'too_large':
        return 'Antwort ist zu gross.';
      case 'redirects':
        return 'Zu viele Weiterleitungen.';
      case 'scheme':
        return 'Nur http- und https-Adressen sind erlaubt.';
      case 'status':
        return `Server antwortete mit Status ${error.status ?? '?'}.`;
      default:
        return 'Abruf fehlgeschlagen (Netzwerkfehler).';
    }
  }
  return 'Abruf fehlgeschlagen.';
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

export class FeedService {
  private readonly db: Db;
  private readonly config: FeedConfig;
  private readonly fetcher: Fetcher;
  private running: Promise<RefreshResult> | undefined;
  private queued: Promise<RefreshResult> | undefined;

  constructor(db: Db, config: FeedConfig, fetcher: Fetcher = safeFetch) {
    this.db = db;
    this.config = config;
    this.fetcher = fetcher;
  }

  private fetchOptions(headers?: Record<string, string>): FetchOptions {
    return {
      allowPrivate: this.config.allowPrivateUrls,
      timeoutMs: this.config.fetchTimeoutMs,
      maxBytes: this.config.maxBytes,
      headers,
    };
  }

  // ---- Sources -------------------------------------------------------------

  listSources(): FeedSource[] {
    const rows = this.db
      .prepare(`${SOURCE_SELECT} GROUP BY s.id ORDER BY s.type, s.title COLLATE NOCASE`)
      .all() as unknown as SourceRow[];
    return rows.map(toSource);
  }

  getSource(id: number): FeedSource | undefined {
    const row = this.db.prepare(`${SOURCE_SELECT} WHERE s.id = ? GROUP BY s.id`).get(id) as SourceRow | undefined;
    return row ? toSource(row) : undefined;
  }

  private sourceRow(id: number): SourceRow | undefined {
    return this.db.prepare('SELECT * FROM feed_sources WHERE id = ?').get(id) as SourceRow | undefined;
  }

  private requireSourceRow(id: number): SourceRow {
    const row = this.sourceRow(id);
    if (!row) throw new HttpError(404, 'source_not_found', 'Quelle nicht gefunden.');
    return row;
  }

  /** Validates the URL and resolves YouTube channel URLs to their RSS feed. */
  async normalizeUrl(raw: string): Promise<string> {
    const valid = safeHttpUrl(raw);
    if (!valid) throw new HttpError(400, 'invalid_url', 'Bitte eine gültige http- oder https-Adresse eingeben.');
    const url = new URL(valid);
    if (url.username || url.password) throw new HttpError(400, 'invalid_url', 'Zugangsdaten in Adressen sind nicht erlaubt.');
    if (!isYouTubeUrl(url, this.config.youtubeBaseUrl)) return url.toString();
    try {
      return await resolveYouTubeFeed(url, this.config.youtubeBaseUrl, this.fetcher, this.fetchOptions());
    } catch (error) {
      throw new HttpError(422, 'youtube_unresolved', describeFeedError(error));
    }
  }

  private async fetchFeed(url: string, row?: SourceRow): Promise<
    { notModified: true } | { notModified: false; feed: ParsedFeed; etag: string | null; lastModified: string | null }
  > {
    const headers: Record<string, string> = {};
    if (row?.last_fetched_at && row.etag) headers['If-None-Match'] = row.etag;
    if (row?.last_fetched_at && row.last_modified) headers['If-Modified-Since'] = row.last_modified;
    const response = await this.fetcher(url, this.fetchOptions(headers));
    if (response.status === 304) return { notModified: true };
    if (response.status < 200 || response.status >= 300) throw new FetchError('status', 'Bad status', response.status);
    const header = (name: string) => {
      const value = response.headers[name];
      return typeof value === 'string' ? truncate(value, 200) : null;
    };
    return {
      notModified: false,
      feed: parseFeed(response.body, response.url),
      etag: header('etag'),
      lastModified: header('last-modified'),
    };
  }

  private detectType(url: string, feed?: ParsedFeed, hint = ''): FeedType {
    if (isYouTubeUrl(new URL(url), this.config.youtubeBaseUrl)) return 'video';
    if (feed?.isPodcast || /podcast/.test(hint)) return 'podcast';
    if (/youtube|video/.test(hint)) return 'video';
    return 'news';
  }

  private assertUniqueUrl(url: string, exceptId?: number): void {
    const row = this.db.prepare('SELECT id FROM feed_sources WHERE url = ?').get(url) as { id: number } | undefined;
    if (row && row.id !== exceptId) throw new HttpError(409, 'duplicate_source', 'Diese Quelle ist bereits abonniert.');
  }

  /** Subscribes to a feed: resolves YouTube URLs, fetches once and stores the items. */
  async addSource(input: { url: string; type?: FeedType; title?: string }): Promise<FeedSource> {
    const url = await this.normalizeUrl(input.url);
    this.assertUniqueUrl(url);
    let fetched: Awaited<ReturnType<FeedService['fetchFeed']>>;
    try {
      fetched = await this.fetchFeed(url);
    } catch (error) {
      throw new HttpError(422, 'feed_unavailable', describeFeedError(error));
    }
    if (fetched.notModified) throw new HttpError(422, 'feed_unavailable', 'Abruf fehlgeschlagen.');
    const { feed, etag, lastModified } = fetched;
    const now = nowIso();
    const id = transaction(this.db, () => {
      this.assertUniqueUrl(url);
      const result = this.db
        .prepare(
          `INSERT INTO feed_sources (title, url, site_url, type, type_auto, etag, last_modified, last_fetched_at, last_attempt_at, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          input.title || feed.title,
          url,
          feed.siteUrl,
          input.type ?? this.detectType(url, feed),
          input.type ? 0 : 1,
          etag,
          lastModified,
          now,
          now,
          now,
        );
      const sourceId = Number(result.lastInsertRowid);
      this.applyItems(sourceId, feed.items, true, now);
      return sourceId;
    });
    return this.getSource(id)!;
  }

  async updateSource(id: number, input: { title?: string; type?: FeedType; url?: string }): Promise<FeedSource> {
    const row = this.requireSourceRow(id);
    let url = row.url;
    if (input.url !== undefined) {
      url = await this.normalizeUrl(input.url);
      this.assertUniqueUrl(url, id);
    }
    const urlChanged = url !== row.url;
    this.db
      .prepare(
        `UPDATE feed_sources SET title = ?, type = ?, type_auto = ?, url = ?,
           etag = CASE WHEN ? THEN NULL ELSE etag END,
           last_modified = CASE WHEN ? THEN NULL ELSE last_modified END,
           last_fetched_at = CASE WHEN ? THEN NULL ELSE last_fetched_at END,
           last_error = CASE WHEN ? THEN NULL ELSE last_error END
         WHERE id = ?`,
      )
      .run(
        input.title || row.title,
        input.type ?? row.type,
        input.type ? 0 : row.type_auto,
        url,
        urlChanged ? 1 : 0,
        urlChanged ? 1 : 0,
        urlChanged ? 1 : 0,
        urlChanged ? 1 : 0,
        id,
      );
    if (urlChanged) await this.refreshSource(id);
    return this.getSource(id)!;
  }

  deleteSource(id: number): void {
    this.requireSourceRow(id);
    this.db.prepare('DELETE FROM feed_sources WHERE id = ?').run(id);
  }

  /** Imports feed outlines from OPML without fetching; new sources are refreshed afterwards. */
  importOpml(text: string): OpmlImportResult {
    let parsed: ReturnType<typeof parseOpml>;
    try {
      parsed = parseOpml(text);
    } catch {
      throw new HttpError(422, 'invalid_opml', 'Ungültige oder zu grosse OPML-Datei (max. 1 MB, 500 Einträge).');
    }
    const result: OpmlImportResult = { added: 0, skipped: 0, invalid: parsed.invalid };
    const now = nowIso();
    transaction(this.db, () => {
      const exists = this.db.prepare('SELECT 1 FROM feed_sources WHERE url = ?');
      const insert = this.db.prepare(
        `INSERT INTO feed_sources (title, url, type, type_auto, created_at) VALUES (?, ?, ?, 1, ?)`,
      );
      for (const entry of parsed.entries) {
        if (exists.get(entry.url)) {
          result.skipped++;
          continue;
        }
        insert.run(entry.title ?? new URL(entry.url).hostname, entry.url, this.detectType(entry.url, undefined, entry.hint), now);
        result.added++;
      }
    });
    return result;
  }

  // ---- Refresh -------------------------------------------------------------

  /**
   * Inserts unseen items. On first subscribe only the newest
   * `firstSubscribeUnread` items stay unread; older archive items are stored as read.
   * Must run inside a transaction.
   */
  private applyItems(sourceId: number, items: ParsedItem[], firstSubscribe: boolean, now: string): number {
    const ordered = items.map((item, index) => ({ item, index }));
    if (firstSubscribe) {
      ordered.sort((a, b) => {
        const pa = a.item.publishedAt ?? '';
        const pb = b.item.publishedAt ?? '';
        return pa === pb ? a.index - b.index : pa < pb ? 1 : -1;
      });
    }
    const seen = this.db.prepare('SELECT 1 FROM feed_seen_items WHERE source_id = ? AND dedup_key = ?');
    const touch = this.db.prepare('UPDATE feed_seen_items SET seen_at = ? WHERE source_id = ? AND dedup_key = ?');
    const insertSeen = this.db.prepare(
      'INSERT OR IGNORE INTO feed_seen_items (source_id, dedup_key, seen_at) VALUES (?, ?, ?)',
    );
    const insertItem = this.db.prepare(
      `INSERT OR IGNORE INTO feed_items (source_id, dedup_key, title, url, summary, published_at, fetched_at, is_read)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const keys = new Set<string>();
    let inserted = 0;
    for (const { item } of ordered) {
      const key = dedupKey(item);
      if (keys.has(key)) continue;
      keys.add(key);
      if (seen.get(sourceId, key)) {
        touch.run(now, sourceId, key);
        continue;
      }
      const read = firstSubscribe && inserted >= this.config.firstSubscribeUnread ? 1 : 0;
      insertItem.run(sourceId, key, item.title, item.link, item.summary, item.publishedAt, now, read);
      insertSeen.run(sourceId, key, now);
      inserted++;
    }
    return inserted;
  }

  /** Fetches one source. Errors are stored on the source, never thrown. Returns new item count or -1 on failure. */
  async refreshSource(id: number): Promise<number> {
    const row = this.sourceRow(id);
    if (!row) return 0;
    const startUrl = row.url;
    const now = nowIso();
    this.db.prepare('UPDATE feed_sources SET last_attempt_at = ? WHERE id = ?').run(now, id);
    try {
      const fetched = await this.fetchFeed(startUrl, row);
      const current = this.sourceRow(id);
      // Discard the response if the source was deleted or its URL changed while fetching.
      if (!current || current.url !== startUrl) return 0;
      return transaction(this.db, () => {
        if (fetched.notModified) {
          this.db.prepare('UPDATE feed_sources SET last_fetched_at = ?, last_error = NULL WHERE id = ?').run(now, id);
          return 0;
        }
        const firstSubscribe = current.last_fetched_at === null;
        const added = this.applyItems(id, fetched.feed.items, firstSubscribe, now);
        const type = firstSubscribe && current.type_auto ? this.detectType(startUrl, fetched.feed, current.type) : current.type;
        this.db
          .prepare(
            `UPDATE feed_sources SET etag = ?, last_modified = ?, last_fetched_at = ?, last_error = NULL,
               site_url = COALESCE(site_url, ?), type = ? WHERE id = ?`,
          )
          .run(fetched.etag, fetched.lastModified, now, fetched.feed.siteUrl, type, id);
        return added;
      });
    } catch (error) {
      const message = describeFeedError(error);
      this.db.prepare('UPDATE feed_sources SET last_error = ? WHERE id = ?').run(truncate(message, 300), id);
      log.warn('feed refresh failed', { sourceId: id, reason: error instanceof FetchError ? error.reason : 'parse' });
      return -1;
    }
  }

  /**
   * Refreshes all sources (or only those not attempted within the refresh
   * interval). Single-flight: concurrent calls never overlap; a call made while
   * a run is active waits for one trailing run.
   */
  refreshAll(options: { onlyDue?: boolean; now?: Date } = {}): Promise<RefreshResult> {
    if (this.running) {
      this.queued ??= this.running.then(() => {
        this.queued = undefined;
        return this.refreshAll(options);
      });
      return this.queued;
    }
    this.running = this.runRefresh(options).finally(() => {
      this.running = undefined;
    });
    return this.running;
  }

  get isRefreshing(): boolean {
    return this.running !== undefined;
  }

  private async runRefresh({ onlyDue = false, now = new Date() }: { onlyDue?: boolean; now?: Date }): Promise<RefreshResult> {
    const cutoff = new Date(now.getTime() - this.config.refreshIntervalMs).toISOString();
    const rows = (
      onlyDue
        ? this.db.prepare('SELECT id, url FROM feed_sources WHERE last_attempt_at IS NULL OR last_attempt_at <= ?').all(cutoff)
        : this.db.prepare('SELECT id, url FROM feed_sources').all()
    ) as { id: number; url: string }[];

    // Sequential per host, at most four hosts in parallel.
    const byHost = new Map<string, number[]>();
    for (const row of rows) {
      const host = new URL(row.url).host;
      byHost.set(host, [...(byHost.get(host) ?? []), row.id]);
    }
    const groups = [...byHost.values()];
    const result: RefreshResult = { refreshed: 0, failed: 0, newItems: 0 };
    const worker = async () => {
      for (let group = groups.shift(); group; group = groups.shift()) {
        for (const id of group) {
          const added = await this.refreshSource(id);
          if (added < 0) result.failed++;
          else {
            result.refreshed++;
            result.newItems += added;
          }
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(4, groups.length) }, worker));
    return result;
  }

  /**
   * Deletes read, non-bookmarked items fetched more than `retentionDays` ago.
   * Their tombstones stay, so they are never re-inserted as unread.
   */
  pruneRetention(now: Date = new Date()): { items: number; tombstones: number } {
    const cutoff = new Date(now.getTime() - this.config.retentionDays * DAY_MS).toISOString();
    const items = this.db
      .prepare('DELETE FROM feed_items WHERE is_read = 1 AND is_bookmarked = 0 AND fetched_at < ?')
      .run(cutoff).changes;
    const tombstoneCutoff = new Date(now.getTime() - TOMBSTONE_GRACE_DAYS * DAY_MS).toISOString();
    const tombstones = this.db
      .prepare(
        `DELETE FROM feed_seen_items WHERE seen_at < ? AND NOT EXISTS (
           SELECT 1 FROM feed_items i WHERE i.source_id = feed_seen_items.source_id AND i.dedup_key = feed_seen_items.dedup_key)`,
      )
      .run(tombstoneCutoff).changes;
    return { items: Number(items), tombstones: Number(tombstones) };
  }

  // ---- Items ---------------------------------------------------------------

  listItems(filter: ItemFilter = {}): { items: FeedItem[]; total: number } {
    const where: string[] = [];
    const params: (string | number)[] = [];
    if (filter.type) {
      where.push('s.type = ?');
      params.push(filter.type);
    }
    if (filter.unread) where.push('i.is_read = 0');
    if (filter.bookmarked) where.push('i.is_bookmarked = 1');
    if (filter.sourceId) {
      where.push('i.source_id = ?');
      params.push(filter.sourceId);
    }
    if (filter.query) {
      where.push(`(i.title LIKE ? ESCAPE '\\' OR i.summary LIKE ? ESCAPE '\\')`);
      const like = `%${escapeLike(filter.query)}%`;
      params.push(like, like);
    }
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const total = (
      this.db.prepare(`SELECT COUNT(*) AS n FROM feed_items i JOIN feed_sources s ON s.id = i.source_id ${clause}`).get(...params) as {
        n: number;
      }
    ).n;
    const rows = this.db
      .prepare(`${ITEM_SELECT} ${clause} ORDER BY COALESCE(i.published_at, i.fetched_at) DESC, i.id DESC LIMIT ? OFFSET ?`)
      .all(...params, filter.limit ?? 50, filter.offset ?? 0) as unknown as ItemRow[];
    return { items: rows.map(toItem), total };
  }

  getItem(id: number): FeedItem | undefined {
    const row = this.db.prepare(`${ITEM_SELECT} WHERE i.id = ?`).get(id) as ItemRow | undefined;
    return row ? toItem(row) : undefined;
  }

  requireItem(id: number): FeedItem {
    const item = this.getItem(id);
    if (!item) throw new HttpError(404, 'item_not_found', 'Eintrag nicht gefunden.');
    return item;
  }

  setItemState(id: number, state: { read?: boolean; bookmarked?: boolean }): FeedItem {
    const item = this.requireItem(id);
    this.db
      .prepare('UPDATE feed_items SET is_read = ?, is_bookmarked = ? WHERE id = ?')
      .run((state.read ?? item.read) ? 1 : 0, (state.bookmarked ?? item.bookmarked) ? 1 : 0, id);
    return this.requireItem(id);
  }

  markAllRead(type?: FeedType): number {
    const result = type
      ? this.db
          .prepare('UPDATE feed_items SET is_read = 1 WHERE is_read = 0 AND source_id IN (SELECT id FROM feed_sources WHERE type = ?)')
          .run(type)
      : this.db.prepare('UPDATE feed_items SET is_read = 1 WHERE is_read = 0').run();
    return Number(result.changes);
  }

  /** Newest unread items per type, bounded so one feed type never dominates. */
  recentUnread(perType = 5): Record<FeedType, { items: FeedItem[]; unreadCount: number }> {
    const result = {} as Record<FeedType, { items: FeedItem[]; unreadCount: number }>;
    for (const type of FEED_TYPES) {
      const { items, total } = this.listItems({ type, unread: true, limit: perType });
      result[type] = { items, unreadCount: total };
    }
    return result;
  }
}
