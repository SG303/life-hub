import http from 'node:http';
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
} from '../fixtures/feeds.ts';

/**
 * Serves deterministic feeds, a fake YouTube host (handle pages, consent wall,
 * channel feeds) and a sample OPML file. `origin` is the base URL under which
 * Life Hub reaches this server (it can differ from the browser's view).
 */
export function createFixtureHandler(origin: () => string) {
  return (req: http.IncomingMessage, res: http.ServerResponse): boolean => {
    const url = new URL(req.url ?? '/', 'http://fixture.invalid');
    const send = (status: number, type: string, body: string, headers: Record<string, string> = {}) => {
      res.writeHead(status, { 'Content-Type': type, ...headers });
      res.end(body);
    };
    const xml = 'application/xml; charset=utf-8';
    switch (url.pathname) {
      case '/feeds/news.xml':
        send(200, 'application/rss+xml; charset=utf-8', newsRss(15, origin()), { ETag: '"news-v1"' });
        return true;
      case '/feeds/podcast.xml':
        send(200, xml, podcastRss(4));
        return true;
      case '/feeds/blog.xml':
        send(200, 'application/atom+xml', blogAtom());
        return true;
      case '/feeds/videos.xml':
        if (url.searchParams.get('channel_id') !== CHANNEL_ID) send(404, 'text/plain', 'unknown channel');
        else send(200, 'application/atom+xml', youtubeAtom());
        return true;
      case `/${CHANNEL_HANDLE}`:
        send(200, 'text/html; charset=utf-8', channelHtml());
        return true;
      case `/${CONSENT_HANDLE}`:
        send(302, 'text/plain', '', { Location: '/consent?continue=1' });
        return true;
      case '/consent':
        send(200, 'text/html; charset=utf-8', consentHtml());
        return true;
      case '/opml/sample.opml':
        send(
          200,
          'text/x-opml; charset=utf-8',
          opml([
            { url: `${origin()}/feeds/blog.xml?src=opml`, title: 'Testblog (OPML)' },
            { url: `${origin()}/feeds/podcast.xml?src=opml`, title: 'Podcast (OPML)', category: 'Podcasts' },
          ]),
        );
        return true;
      default:
        return false;
    }
  };
}
