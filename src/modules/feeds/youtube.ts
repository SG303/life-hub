import type { FetchOptions, Fetcher } from './net.js';

const YOUTUBE_HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com']);
const CHANNEL_ID = /^UC[\w-]{22}$/;

export class YouTubeResolveError extends Error {}

export const YOUTUBE_FALLBACK_MESSAGE =
  'YouTube-Kanal konnte nicht automatisch aufgelöst werden. Bitte die RSS-Adresse direkt eintragen: ' +
  'https://www.youtube.com/feeds/videos.xml?channel_id=UC… (Kanal-ID aus der Kanal-Seite unter «Teilen» → «Kanal-ID kopieren»).';

const YOUTUBE_PATH = /^\/(channel\/|@|c\/|user\/|feeds\/videos\.xml$)/;

/**
 * `baseUrl` is `https://www.youtube.com` in production; tests inject a local
 * fixture server, whose channel-like paths are then also treated as YouTube.
 */
export function isYouTubeUrl(url: URL, baseUrl: string): boolean {
  if (YOUTUBE_HOSTS.has(url.hostname.toLowerCase())) return true;
  return url.origin === new URL(baseUrl).origin && YOUTUBE_PATH.test(url.pathname);
}

export function isYouTubeFeedUrl(url: URL, baseUrl: string): boolean {
  return isYouTubeUrl(url, baseUrl) && url.pathname === '/feeds/videos.xml';
}

export function channelFeedUrl(channelId: string, baseUrl: string): string {
  return `${baseUrl}/feeds/videos.xml?channel_id=${channelId}`;
}

/** Extracts the channel ID from a channel page; returns `undefined` if none is found. */
export function channelIdFromHtml(html: string): string | undefined {
  const patterns = [
    /<link\s+rel="canonical"\s+href="https?:\/\/(?:www\.)?youtube\.com\/channel\/(UC[\w-]{22})"/i,
    /<meta\s+itemprop="(?:identifier|channelId)"\s+content="(UC[\w-]{22})"/i,
    /"externalId"\s*:\s*"(UC[\w-]{22})"/,
    /"channelId"\s*:\s*"(UC[\w-]{22})"/,
    /\/feeds\/videos\.xml\?channel_id=(UC[\w-]{22})/,
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(html);
    if (match) return match[1];
  }
  return undefined;
}

/**
 * Turns a YouTube channel URL into its RSS feed URL. `/channel/UC…` is resolved
 * locally; handles (`/@name`), `/c/…` and `/user/…` are looked up on the
 * YouTube host with consent cookies. Throws `YouTubeResolveError` with a
 * German fallback message when resolution fails.
 */
export async function resolveYouTubeFeed(
  url: URL,
  baseUrl: string,
  fetcher: Fetcher,
  options: FetchOptions,
): Promise<string> {
  if (isYouTubeFeedUrl(url, baseUrl)) return url.toString();
  const segments = url.pathname.split('/').filter(Boolean);
  if (segments[0] === 'channel' && segments[1] && CHANNEL_ID.test(segments[1])) {
    return channelFeedUrl(segments[1], baseUrl);
  }
  const isHandle = segments[0]?.startsWith('@');
  const isLegacy = (segments[0] === 'c' || segments[0] === 'user') && segments[1];
  if (!isHandle && !isLegacy) throw new YouTubeResolveError(YOUTUBE_FALLBACK_MESSAGE);

  const path = isHandle ? `/${segments[0]}` : `/${segments[0]}/${segments[1]}`;
  try {
    const page = await fetcher(`${baseUrl}${path}`, {
      ...options,
      headers: { Cookie: 'CONSENT=YES+cb; SOCS=CAI', 'Accept-Language': 'de-CH,de;q=0.9,en;q=0.8', Accept: 'text/html' },
    });
    const finalHost = new URL(page.url).hostname;
    if (page.status !== 200 || finalHost.startsWith('consent.')) throw new YouTubeResolveError(YOUTUBE_FALLBACK_MESSAGE);
    const channelId = channelIdFromHtml(page.body);
    if (!channelId) throw new YouTubeResolveError(YOUTUBE_FALLBACK_MESSAGE);
    return channelFeedUrl(channelId, baseUrl);
  } catch (error) {
    if (error instanceof YouTubeResolveError) throw error;
    throw new YouTubeResolveError(YOUTUBE_FALLBACK_MESSAGE);
  }
}
