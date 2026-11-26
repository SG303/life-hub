import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DB_FILE, openDatabase, openMemoryDatabase } from '../src/core/db.ts';
import { migrations } from '../src/core/migrations.ts';
import { FeedService } from '../src/modules/feeds/index.ts';
import { FeedScheduler } from '../src/modules/feeds/scheduler.ts';
import { parseOpml } from '../src/modules/feeds/opml.ts';
import { dedupKey, parseFeed } from '../src/modules/feeds/parser.ts';
import { channelIdFromHtml, isYouTubeUrl, resolveYouTubeFeed, YOUTUBE_FALLBACK_MESSAGE } from '../src/modules/feeds/youtube.ts';
import {
  blogAtom,
  CHANNEL_HANDLE,
  CHANNEL_ID,
  channelHtml,
  CONSENT_HANDLE,
  consentHtml,
  newsRss,
  opml,
  podcastRss,
  youtubeAtom,
} from './fixtures/feeds.ts';
import { fakeFetcher, testConfig, type Route } from './helpers.ts';

const NEWS = 'https://news.example/feed.xml';
const PODCAST = 'https://podcast.example/feed.xml';
const YT_FEED = `https://www.youtube.com/feeds/videos.xml?channel_id=${CHANNEL_ID}`;

function service(routes: Record<string, Route | (() => Route)>, env: Record<string, string> = {}) {
  const fetcher = fakeFetcher(routes);
  const feeds = new FeedService(openMemoryDatabase(), testConfig(env).feeds, fetcher);
  return { feeds, fetcher };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('feed parsing', () => {
  it('parses RSS and strips untrusted HTML to plain text', () => {
    const feed = parseFeed(newsRss(15), NEWS);
    expect(feed.title).toBe('Testnachrichten');
    expect(feed.items).toHaveLength(15);
    const evil = feed.items[0]!;
    expect(evil.title).toBe('Sicherheit Testartikel');
    expect(evil.title).not.toMatch(/script/i);
    expect(evil.summary).not.toMatch(/<|onerror|pixel\.png/);
    expect(evil.summary).toContain('Vorschau Ende');
    expect(evil.link).toBeNull(); // javascript: link dropped
    expect(feed.items[1]!.title).toBe('Meldung 2: Lokales & Regionales');
    expect(feed.items[1]!.summary).toBe('Zusammenfassung von Meldung 2.');
    expect(feed.isPodcast).toBe(false);
  });

  it('parses YouTube Atom with yt:videoId and media description', () => {
    const feed = parseFeed(youtubeAtom(), YT_FEED);
    expect(feed.items[0]).toMatchObject({
      guid: 'yt:video:vid1xxxxxxx',
      videoId: 'vid1xxxxxxx',
      link: 'https://www.youtube.com/watch?v=vid1xxxxxxx',
      summary: 'Beschreibung von Video 1.',
    });
  });

  it('detects podcasts and resolves relative Atom links', () => {
    expect(parseFeed(podcastRss(), PODCAST).isPodcast).toBe(true);
    const blog = parseFeed(blogAtom(), 'https://blog.example/atom.xml');
    expect(blog.items[0]!.link).toBe('https://blog.example/beitrag/1');
    expect(blog.items[0]!.title).toBe('Erster Beitrag');
    expect(blog.items[1]!.summary).toBe('Zweiter');
  });

  it('builds deterministic dedup keys: guid -> yt:videoId -> link -> hash', () => {
    const base = { title: 'T', summary: 'S', publishedAt: null, hasAudio: false };
    expect(dedupKey({ ...base, guid: 'g', videoId: 'v', link: 'https://l.example' })).toBe('guid:g');
    expect(dedupKey({ ...base, guid: null, videoId: 'v', link: 'https://l.example' })).toBe('yt:v');
    expect(dedupKey({ ...base, guid: null, videoId: null, link: 'https://l.example' })).toBe('link:https://l.example');
    const hash = dedupKey({ ...base, guid: null, videoId: null, link: null });
    expect(hash).toMatch(/^hash:[0-9a-f]{64}$/);
    expect(dedupKey({ ...base, guid: null, videoId: null, link: null })).toBe(hash);
  });

  it('rejects entity declarations (XXE / billion laughs)', () => {
    const xxe = '<?xml version="1.0"?><!DOCTYPE r [<!ENTITY x SYSTEM "file:///etc/passwd">]><rss><channel><title>&x;</title></channel></rss>';
    expect(() => parseFeed(xxe)).toThrow();
    expect(() => parseFeed('<html><body>no feed</body></html>')).toThrow();
  });
});

describe('subscribing and refreshing', () => {
  it('marks only the newest 10 items unread on first subscribe and never duplicates on re-poll', async () => {
    const { feeds } = service({ [NEWS]: newsRss(15) });
    const source = await feeds.addSource({ url: NEWS });
    expect(source).toMatchObject({ type: 'news', title: 'Testnachrichten', itemCount: 15, unreadCount: 10 });
    const unread = feeds.listItems({ unread: true, limit: 50 }).items;
    expect(unread.map((item) => item.title)).toContain('Sicherheit Testartikel');
    expect(unread.every((item) => !item.title.startsWith('Meldung 15'))).toBe(true);

    await feeds.refreshAll();
    await feeds.refreshAll();
    expect(feeds.listItems({ limit: 50 }).total).toBe(15);
    expect(feeds.getSource(source.id)!.unreadCount).toBe(10);
  });

  it('marks new items after the first fetch as unread', async () => {
    let body = newsRss(3);
    const { feeds } = service({ [NEWS]: () => body });
    await feeds.addSource({ url: NEWS });
    feeds.markAllRead();
    body = newsRss(5);
    await feeds.refreshAll();
    expect(feeds.listItems({ unread: true }).items.map((item) => item.title)).toEqual([
      'Meldung 4: Lokales & Regionales',
      'Meldung 5: Lokales & Regionales',
    ]);
  });

  it('detects type, rejects duplicates and stores German fetch errors', async () => {
    const { feeds } = service({ [PODCAST]: podcastRss(), [NEWS]: newsRss(2) });
    expect((await feeds.addSource({ url: PODCAST })).type).toBe('podcast');
    await expect(feeds.addSource({ url: PODCAST })).rejects.toThrow(/bereits abonniert/);
    await expect(feeds.addSource({ url: 'https://missing.example/feed' })).rejects.toThrow(/Status 404/);
    await expect(feeds.addSource({ url: 'ftp://files.example/feed' })).rejects.toThrow(/http/);
  });

  it('uses conditional requests and keeps items on 304', async () => {
    const requests: string[] = [];
    let first = true;
    const feeds = new FeedService(openMemoryDatabase(), testConfig().feeds, async (url, options) => {
      requests.push(JSON.stringify(options.headers ?? {}));
      if (first) {
        first = false;
        return { status: 200, url, headers: { etag: '"v1"' }, body: newsRss(2) };
      }
      return { status: 304, url, headers: {}, body: '' };
    });
    await feeds.addSource({ url: NEWS });
    await feeds.refreshAll();
    expect(requests[1]).toContain('"If-None-Match":"\\"v1\\""');
    expect(feeds.listItems().total).toBe(2);
  });

  it('discards a response if the source URL changed while fetching', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    const other = 'https://other.example/feed.xml';
    let slow = false;
    const feeds = new FeedService(openMemoryDatabase(), testConfig().feeds, async (url) => {
      if (slow && url === NEWS) {
        await gate;
        return { status: 200, url, headers: {}, body: newsRss(6) };
      }
      return { status: 200, url, headers: {}, body: url === other ? podcastRss(1) : newsRss(2) };
    });
    const source = await feeds.addSource({ url: NEWS });
    slow = true;
    const refreshing = feeds.refreshSource(source.id);
    await feeds.updateSource(source.id, { url: other });
    release();
    expect(await refreshing).toBe(0);
    expect(feeds.listItems({ limit: 50 }).items.some((item) => item.title.startsWith('Meldung 6'))).toBe(false);
  });
});

describe('YouTube channel resolution', () => {
  const base = 'https://www.youtube.com';
  const options = { allowPrivate: false, timeoutMs: 1000, maxBytes: 100_000 };

  it('resolves /channel/UC… locally without network', async () => {
    const fetcher = fakeFetcher({});
    const url = await resolveYouTubeFeed(new URL(`${base}/channel/${CHANNEL_ID}`), base, fetcher, options);
    expect(url).toBe(YT_FEED);
    expect(fetcher.calls).toEqual([]);
  });

  it('resolves handles from the channel page with consent cookies', async () => {
    let cookie = '';
    const url = await resolveYouTubeFeed(new URL(`${base}/${CHANNEL_HANDLE}/videos`), base, async (target, opts) => {
      cookie = opts.headers?.Cookie ?? '';
      return { status: 200, url: target, headers: {}, body: channelHtml() };
    }, options);
    expect(url).toBe(YT_FEED);
    expect(cookie).toContain('SOCS=');
  });

  it('falls back with a German hint when the consent page blocks resolution', async () => {
    const fetcher = fakeFetcher({
      [`${base}/${CONSENT_HANDLE}`]: { url: 'https://consent.youtube.com/m?continue=x', body: consentHtml() },
    });
    await expect(resolveYouTubeFeed(new URL(`${base}/${CONSENT_HANDLE}`), base, fetcher, options)).rejects.toThrow(
      YOUTUBE_FALLBACK_MESSAGE,
    );
    await expect(resolveYouTubeFeed(new URL(`${base}/watch?v=abc`), base, fetcher, options)).rejects.toThrow(/RSS-Adresse/);
  });

  it('only accepts channel pages served from YouTube hosts (no redirects elsewhere)', async () => {
    let allowRedirect: ((url: URL) => boolean) | undefined;
    const fetcher = async (target: string, opts: { allowRedirect?: (url: URL) => boolean }) => {
      allowRedirect = opts.allowRedirect;
      return { status: 200, url: 'https://evil.example/fake-channel', headers: {}, body: channelHtml() };
    };
    await expect(resolveYouTubeFeed(new URL(`${base}/${CHANNEL_HANDLE}`), base, fetcher, options)).rejects.toThrow(
      YOUTUBE_FALLBACK_MESSAGE,
    );
    expect(allowRedirect?.(new URL('https://m.youtube.com/@x'))).toBe(true);
    expect(allowRedirect?.(new URL('https://evil.example/@x'))).toBe(false);
  });

  it('treats only channel-like paths on an injected test origin as YouTube', () => {
    const local = 'http://192.0.2.5:4610';
    expect(isYouTubeUrl(new URL(`${local}/@kanal`), local)).toBe(true);
    expect(isYouTubeUrl(new URL(`${local}/feeds/news.xml`), local)).toBe(false);
    expect(isYouTubeUrl(new URL('https://m.youtube.com/watch?v=x'), base)).toBe(true);
  });

  it('extracts channel IDs from several page formats', () => {
    expect(channelIdFromHtml(channelHtml())).toBe(CHANNEL_ID);
    expect(channelIdFromHtml(`{"externalId":"${CHANNEL_ID}"}`)).toBe(CHANNEL_ID);
    expect(channelIdFromHtml(consentHtml())).toBeUndefined();
  });

  it('subscribes to a handle URL as a video source', async () => {
    const { feeds } = service({ [`https://www.youtube.com/${CHANNEL_HANDLE}`]: channelHtml(), [YT_FEED]: youtubeAtom() });
    const source = await feeds.addSource({ url: `https://youtube.com/${CHANNEL_HANDLE}` });
    expect(source).toMatchObject({ url: YT_FEED, type: 'video', itemCount: 3 });
  });
});

describe('OPML import', () => {
  it('auto-detects types, skips duplicates and counts invalid outlines', async () => {
    const { feeds } = service({ [NEWS]: newsRss(2) });
    await feeds.addSource({ url: NEWS });
    const doc = opml([
      { url: NEWS, title: 'Schon da' },
      { url: YT_FEED, title: 'Kanal' },
      { url: PODCAST, title: 'Mein Podcast' },
      { url: 'https://blog.example/atom.xml', title: 'Blog' },
      { url: 'https://blog.example/atom.xml', title: 'Blog doppelt' },
      { url: 'javascript:alert(1)', title: 'Böse' },
      { url: 'https://user:secret@private.example/feed.xml', title: 'Mit Passwort' },
    ]);
    expect(feeds.importOpml(doc)).toEqual({ added: 3, skipped: 2, invalid: 2 });
    const types = Object.fromEntries(feeds.listSources().map((s) => [s.title, s.type]));
    expect(types).toMatchObject({ Kanal: 'video', 'Mein Podcast': 'podcast', Blog: 'news' });
  });

  it('refines the auto-detected type on the first fetch', async () => {
    const { feeds } = service({ 'https://audio.example/rss': podcastRss(2) });
    feeds.importOpml(opml([{ url: 'https://audio.example/rss', title: 'Unbekannt' }]));
    await feeds.refreshAll();
    expect(feeds.listSources()[0]!.type).toBe('podcast');
  });

  it('enforces size and outline limits', () => {
    const many = opml(Array.from({ length: 501 }, (_, i) => ({ url: `https://x.example/${i}`, title: `F${i}` })));
    expect(() => parseOpml(many)).toThrow(/outlines/);
    expect(() => parseOpml('x'.repeat(1024 * 1024 + 1))).toThrow(/too large/);
  });
});

describe('retention', () => {
  it('prunes old read, non-bookmarked items and never resurrects them as unread', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-01T10:00:00Z'));
    const { feeds } = service({ [NEWS]: newsRss(4) });
    await feeds.addSource({ url: NEWS });
    const items = feeds.listItems({ limit: 50 }).items;
    feeds.setItemState(items[0]!.id, { read: true });
    feeds.setItemState(items[1]!.id, { read: true, bookmarked: true });
    // items[2] and items[3] stay unread

    vi.setSystemTime(new Date('2026-11-05T10:00:00Z'));
    expect(feeds.pruneRetention(new Date())).toMatchObject({ items: 1 });
    const left = feeds.listItems({ limit: 50 }).items.map((item) => item.id);
    expect(left).not.toContain(items[0]!.id);
    expect(left).toEqual(expect.arrayContaining([items[1]!.id, items[2]!.id, items[3]!.id]));

    await feeds.refreshAll();
    expect(feeds.listItems({ limit: 50 }).total).toBe(3);
    expect(feeds.listItems({ unread: true }).items.map((i) => i.title)).not.toContain(items[0]!.title);
  });

  it('keeps tombstones of pruned items even when the feed answered 304 for months', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-01-01T10:00:00Z'));
    let notModified = false;
    const { feeds } = service({ [NEWS]: () => (notModified ? { status: 304 } : newsRss(4)) });
    const source = await feeds.addSource({ url: NEWS });
    feeds.markAllRead();

    notModified = true;
    for (const day of ['2026-03-01', '2026-05-01', '2026-07-01', '2026-09-01']) {
      vi.setSystemTime(new Date(`${day}T10:00:00Z`));
      await feeds.refreshSource(source.id);
      feeds.pruneRetention(new Date());
    }
    expect(feeds.listItems({ limit: 50 }).total).toBe(0);

    notModified = false;
    await feeds.refreshSource(source.id);
    expect(feeds.listItems({ limit: 50 }).total).toBe(0);
  });
});

describe('scheduler', () => {
  it('never runs two refreshes at the same time (single-flight)', async () => {
    let active = 0;
    let maxActive = 0;
    let calls = 0;
    const feeds = new FeedService(openMemoryDatabase(), testConfig().feeds, async (url) => {
      calls++;
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 20));
      active--;
      return { status: 200, url, headers: {}, body: newsRss(2) };
    });
    feeds.importOpml(opml([{ url: NEWS, title: 'A' }]));
    const runs = await Promise.all([feeds.refreshAll(), feeds.refreshAll(), feeds.refreshAll()]);
    expect(maxActive).toBe(1);
    expect(calls).toBe(2); // the active run plus one trailing run for all waiting callers
    expect(runs[1]).toBe(runs[2]);
  });

  it('catches up overdue sources on start and refreshes on the configured interval', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-24T10:00:00Z'));
    const { feeds, fetcher } = service({ [NEWS]: newsRss(1), [PODCAST]: podcastRss(1) }, { FEED_REFRESH_INTERVAL_MS: '60000' });
    feeds.importOpml(opml([{ url: NEWS, title: 'A' }, { url: PODCAST, title: 'B' }]));
    await feeds.refreshSource(feeds.listSources().find((s) => s.url === PODCAST)!.id);
    fetcher.calls.length = 0;

    const scheduler = new FeedScheduler(feeds, 60_000);
    scheduler.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(fetcher.calls).toEqual([NEWS]); // only the overdue (never fetched) source

    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetcher.calls.slice(1).sort()).toEqual([NEWS, PODCAST]);
    scheduler.stop();
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(fetcher.calls).toHaveLength(3);
  });

  it('treats sources not attempted within the interval as due', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-24T10:00:00Z'));
    const { feeds, fetcher } = service({ [NEWS]: newsRss(1) });
    await feeds.addSource({ url: NEWS });
    fetcher.calls.length = 0;
    await feeds.refreshAll({ onlyDue: true });
    expect(fetcher.calls).toEqual([]);
    vi.setSystemTime(new Date(Date.now() + 31 * 60_000));
    await feeds.refreshAll({ onlyDue: true });
    expect(fetcher.calls).toEqual([NEWS]);
  });
});

describe('expiring bookmarks', () => {
  it('migration v4 backfills existing bookmarks with a 14-day expiry and sets default to 14 days', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'life-hub-mig4-'));
    try {
      const legacy = new DatabaseSync(path.join(dir, DB_FILE));
      for (const m of migrations.filter((m) => m.version <= 3)) {
        legacy.exec(m.sql);
        legacy.exec(`PRAGMA user_version = ${m.version}`);
      }
      legacy
        .prepare("INSERT INTO feed_sources (title, url, type, created_at) VALUES ('News', 'https://news.example/rss', 'news', '2026-01-01T00:00:00.000Z')")
        .run();
      legacy
        .prepare(
          `INSERT INTO feed_items (source_id, dedup_key, title, summary, fetched_at, is_read, is_bookmarked)
           VALUES (1, 'k1', 'Gemerkter Artikel', '', '2026-01-01T00:00:00.000Z', 1, 1),
                  (1, 'k2', 'Normaler Artikel', '', '2026-01-01T00:00:00.000Z', 0, 0)`,
        )
        .run();
      legacy.close();

      const before = Date.now();
      const db = openDatabase(dir);
      const feeds = new FeedService(db, testConfig().feeds, fakeFetcher({}));
      expect(feeds.getBookmarkSettings()).toEqual({ bookmarkExpiryDays: 14 });

      const bookmarked = feeds.listItems({ bookmarked: true }).items;
      expect(bookmarked).toHaveLength(1);
      expect(bookmarked[0]!.bookmarkExpired).toBe(false);
      expect(bookmarked[0]!.bookmarkExpiresAt).not.toBeNull();
      const expiryMs = Date.parse(bookmarked[0]!.bookmarkExpiresAt!);
      expect(expiryMs).toBeGreaterThanOrEqual(before + 13.9 * 86_400_000);
      expect(expiryMs).toBeLessThanOrEqual(Date.now() + 14.1 * 86_400_000);

      const normal = feeds.listItems().items.find((i) => i.title === 'Normaler Artikel')!;
      expect(normal.bookmarkExpiresAt).toBeNull();
      expect(normal.bookmarkExpired).toBe(false);
      db.close();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('persists default expiry setting (7/14/30/null) without changing existing bookmarks', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-01T10:00:00.000Z'));
    const { feeds } = service({ [NEWS]: newsRss(4) });
    await feeds.addSource({ url: NEWS });
    const [first, second, third] = feeds.listItems({ limit: 10 }).items;

    expect(feeds.getBookmarkSettings()).toEqual({ bookmarkExpiryDays: 14 });
    const b1 = feeds.setItemState(first!.id, { bookmarked: true });
    expect(b1.bookmarkExpiresAt).toBe('2026-10-15T10:00:00.000Z');
    expect(b1.bookmarkExpired).toBe(false);

    // Changing default to 7 days affects only newly bookmarked items.
    expect(feeds.setBookmarkSettings({ bookmarkExpiryDays: 7 })).toEqual({ bookmarkExpiryDays: 7 });
    expect(feeds.getItem(first!.id)!.bookmarkExpiresAt).toBe('2026-10-15T10:00:00.000Z');
    const b2 = feeds.setItemState(second!.id, { bookmarked: true });
    expect(b2.bookmarkExpiresAt).toBe('2026-10-08T10:00:00.000Z');

    // Setting default to Off creates permanent bookmarks (null expiry).
    expect(feeds.setBookmarkSettings({ bookmarkExpiryDays: null })).toEqual({ bookmarkExpiryDays: null });
    const b3 = feeds.setItemState(third!.id, { bookmarked: true });
    expect(b3.bookmarkExpiresAt).toBeNull();
    expect(b3.bookmarkExpired).toBe(false);

    // Invalid value rejected.
    expect(() => feeds.setBookmarkSettings({ bookmarkExpiryDays: 99 as unknown as 14 })).toThrow(/Ablauf-Frist/);
  });

  it('detects expiry, sorts expired first, supports extend/permanent/release/undo, and keeps expiry on read toggle', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-01T10:00:00.000Z'));
    const { feeds } = service({ [NEWS]: newsRss(8) });
    await feeds.addSource({ url: NEWS });
    const items = feeds.listItems({ limit: 10 }).items;

    // Bookmark 7 items: 6 expired at staggered times, 1 active.
    for (let i = 0; i < 6; i++) {
      feeds.setItemState(items[i]!.id, {
        bookmarked: true,
        bookmarkExpiry: new Date(Date.UTC(2026, 9, 10 + i, 10, 0, 0)).toISOString(),
      });
    }
    feeds.setItemState(items[6]!.id, {
      bookmarked: true,
      bookmarkExpiry: '2026-10-30T10:00:00.000Z',
    });

    // Advance to Oct 20: first 6 are expired, 7th is active.
    vi.setSystemTime(new Date('2026-10-20T10:00:00.000Z'));

    // Opening link (marking read) must not alter bookmark expiry.
    const opened = feeds.setItemState(items[0]!.id, { read: true });
    expect(opened.read).toBe(true);
    expect(opened.bookmarked).toBe(true);
    expect(opened.bookmarkExpiresAt).toBe('2026-10-10T10:00:00.000Z');
    expect(opened.bookmarkExpired).toBe(true);

    // Bookmarked list puts expired items first (oldest-expired first), then active.
    const listed = feeds.listItems({ bookmarked: true, limit: 20 });
    expect(listed.total).toBe(7);
    expect(listed.items.slice(0, 6).every((i) => i.bookmarkExpired)).toBe(true);
    expect(listed.items[0]!.id).toBe(items[0]!.id);
    expect(listed.items[6]!.id).toBe(items[6]!.id);
    expect(listed.items[6]!.bookmarkExpired).toBe(false);

    // Cockpit summary caps expiredBookmarks at 5 and reports total 6.
    const cockpit = feeds.cockpitSummary(5, 5, new Date());
    expect(cockpit.expiredBookmarks.total).toBe(6);
    expect(cockpit.expiredBookmarks.items).toHaveLength(5);
    expect(cockpit.expiredBookmarks.defaultExpiryDays).toBe(14);

    // Extend resets expiry by default (14 days -> Nov 3).
    const extended = feeds.setItemState(items[0]!.id, { bookmarkExpiry: 'extend' });
    expect(extended.bookmarkExpiresAt).toBe('2026-11-03T10:00:00.000Z');
    expect(extended.bookmarkExpired).toBe(false);

    // Mark permanent clears expiry; switching back to extend re-applies expiry.
    const perm = feeds.setItemState(items[1]!.id, { bookmarkExpiry: 'permanent' });
    expect(perm.bookmarkExpiresAt).toBeNull();
    expect(perm.bookmarkExpired).toBe(false);
    const back = feeds.setItemState(items[1]!.id, { bookmarkExpiry: 'extend' });
    expect(back.bookmarkExpiresAt).toBe('2026-11-03T10:00:00.000Z');

    // Release unbookmarks & marks read; undo restores exact previous read & expiry.
    const beforeRelease = feeds.requireItem(items[2]!.id);
    const released = feeds.setItemState(items[2]!.id, { bookmarked: false, read: true });
    expect(released.bookmarked).toBe(false);
    expect(released.read).toBe(true);
    expect(released.bookmarkExpiresAt).toBeNull();
    const restored = feeds.setItemState(items[2]!.id, {
      bookmarked: true,
      read: beforeRelease.read,
      bookmarkExpiry: beforeRelease.bookmarkExpiresAt,
    });
    expect(restored.bookmarked).toBe(true);
    expect(restored.read).toBe(beforeRelease.read);
    expect(restored.bookmarkExpiresAt).toBe(beforeRelease.bookmarkExpiresAt);
    expect(restored.bookmarkExpired).toBe(true);

    // Extending when default is Off makes the bookmark permanent.
    feeds.setBookmarkSettings({ bookmarkExpiryDays: null });
    const extendedWhenOff = feeds.setItemState(items[3]!.id, { bookmarkExpiry: 'extend' });
    expect(extendedWhenOff.bookmarkExpiresAt).toBeNull();
    expect(extendedWhenOff.bookmarkExpired).toBe(false);
  });

  it('protects expired bookmarks from retention pruning and prunes them once released', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-01T10:00:00.000Z'));
    const { feeds } = service({ [NEWS]: newsRss(3) });
    await feeds.addSource({ url: NEWS });
    const [first, second] = feeds.listItems({ limit: 10 }).items;

    // Both read and bookmarked with 14-day expiry (Oct 15).
    feeds.setItemState(first!.id, { read: true, bookmarked: true });
    feeds.setItemState(second!.id, { read: true, bookmarked: true });

    // Advance past both bookmark expiry (14d) and feed retention (30d).
    vi.setSystemTime(new Date('2026-11-10T10:00:00.000Z'));
    expect(feeds.requireItem(first!.id).bookmarkExpired).toBe(true);
    expect(feeds.pruneRetention(new Date())).toEqual({ items: 0 });
    expect(feeds.getItem(first!.id)).toBeDefined();

    // Release first bookmark -> now retention prunes it, while second stays protected.
    feeds.setItemState(first!.id, { bookmarked: false, read: true });
    expect(feeds.pruneRetention(new Date())).toEqual({ items: 1 });
    expect(feeds.getItem(first!.id)).toBeUndefined();
    expect(feeds.getItem(second!.id)).toBeDefined();
  });
});
