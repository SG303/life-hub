import { describe, expect, it } from 'vitest';
import { DEFAULT_LINK_APPS, itemLink, parseLinkApps, type LinkAppSettings } from './linkApps';

const news = { type: 'news' as const, url: 'https://news.example.com/a/b?x=1#top', title: 'Artikel', sourceUrl: 'https://news.example.com/feed.xml' };
const video = { type: 'video' as const, url: 'https://www.youtube.com/watch?v=abc123', title: 'Video', sourceUrl: 'https://www.youtube.com/feeds/videos.xml?channel_id=X' };
const podcast = { type: 'podcast' as const, url: 'https://pod.example.com/ep/1', title: 'Folge 1: Hallo & Tschüss', sourceUrl: 'https://pod.example.com/feed.rss' };

function settings(patch: Partial<LinkAppSettings>): LinkAppSettings {
  return { ...DEFAULT_LINK_APPS, ...patch };
}

describe('itemLink', () => {
  it('keeps the normal link for Standard, off Android and without a URL', () => {
    expect(itemLink(news, DEFAULT_LINK_APPS, true)).toEqual({ href: news.url, app: false });
    expect(itemLink(news, settings({ news: { app: 'brave' } }), false)).toEqual({ href: news.url, app: false });
    expect(itemLink({ ...news, url: null }, settings({ news: { app: 'brave' } }), true)).toBeNull();
  });

  it('opens news in the chosen browser with the page as fallback', () => {
    expect(itemLink(news, settings({ news: { app: 'brave' } }), true)).toEqual({
      href:
        'intent://news.example.com/a/b?x=1#Intent;scheme=https;package=com.brave.browser;S.browser_fallback_url=' +
        encodeURIComponent(news.url) +
        ';end',
      app: true,
    });
  });

  it('hands YouTube links to NewPipe', () => {
    expect(itemLink(video, settings({ video: { app: 'newpipe' } }), true)?.href).toBe(
      `intent://www.youtube.com/watch?v=abc123#Intent;scheme=https;package=org.schabi.newpipe;S.browser_fallback_url=${encodeURIComponent(video.url)};end`,
    );
  });

  it('opens the podcast feed in AntennaPod and searches the episode in Spotify', () => {
    expect(itemLink(podcast, settings({ podcast: { app: 'antennapod' } }), true)?.href).toBe(
      `intent://antennapod.org/deeplink/subscribe?url=${encodeURIComponent(podcast.sourceUrl)}#Intent;scheme=https;package=de.danoeh.antennapod;S.browser_fallback_url=${encodeURIComponent(podcast.url)};end`,
    );
    const search = `https://open.spotify.com/search/${encodeURIComponent(podcast.title)}`;
    expect(itemLink(podcast, settings({ podcast: { app: 'spotify' } }), true)?.href).toBe(
      `intent://open.spotify.com/search/${encodeURIComponent(podcast.title)}#Intent;scheme=https;package=com.spotify.music;S.browser_fallback_url=${encodeURIComponent(search)};end`,
    );
  });

  it('uses a custom package name', () => {
    expect(itemLink(news, settings({ news: { app: 'custom', package: 'org.example.reader' } }), true)?.href).toContain(
      ';package=org.example.reader;',
    );
  });

  it('never wraps non-http links', () => {
    const odd = { ...news, url: 'javascript:alert(1)' };
    expect(itemLink(odd, settings({ news: { app: 'brave' } }), true)).toEqual({ href: odd.url, app: false });
  });
});

describe('parseLinkApps', () => {
  it('falls back to Standard for missing, broken or unknown values', () => {
    expect(parseLinkApps(null)).toEqual(DEFAULT_LINK_APPS);
    expect(parseLinkApps('{nope')).toEqual(DEFAULT_LINK_APPS);
    expect(
      parseLinkApps(
        JSON.stringify({
          news: { app: 'newpipe' },
          video: { app: 'custom', package: 'not a package;evil' },
          podcast: { app: 'antennapod' },
        }),
      ),
    ).toEqual({ news: { app: 'default' }, video: { app: 'default' }, podcast: { app: 'antennapod' } });
  });

  it('keeps a valid custom package', () => {
    expect(parseLinkApps(JSON.stringify({ news: { app: 'custom', package: 'org.example.app' } })).news).toEqual({
      app: 'custom',
      package: 'org.example.app',
    });
  });
});
