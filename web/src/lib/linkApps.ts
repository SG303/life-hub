import type { FeedItem, FeedType } from './api';

/**
 * Per-device choice of the Android app that opens feed links. A web app cannot see which apps are
 * installed, so the list is fixed; "custom" takes any package name. Links become Android intent URLs
 * (Chromium browsers and installed PWAs) with the normal page as fallback when the app is missing.
 */
export type LinkAppId = 'default' | 'brave' | 'firefox' | 'chrome' | 'newpipe' | 'youtube' | 'antennapod' | 'spotify' | 'custom';

export interface LinkAppChoice {
  app: LinkAppId;
  /** Android package name, used only with `custom`. */
  package?: string;
}

export type LinkAppSettings = Record<FeedType, LinkAppChoice>;

export const LINK_APP_LABEL: Record<LinkAppId, string> = {
  default: 'Standard',
  brave: 'Brave',
  firefox: 'Firefox',
  chrome: 'Chrome',
  newpipe: 'NewPipe',
  youtube: 'YouTube',
  antennapod: 'AntennaPod',
  spotify: 'In Spotify suchen',
  custom: 'Andere App …',
};

const PACKAGE: Partial<Record<LinkAppId, string>> = {
  brave: 'com.brave.browser',
  firefox: 'org.mozilla.firefox',
  chrome: 'com.android.chrome',
  newpipe: 'org.schabi.newpipe',
  youtube: 'com.google.android.youtube',
  antennapod: 'de.danoeh.antennapod',
  spotify: 'com.spotify.music',
};

const BROWSERS: LinkAppId[] = ['brave', 'firefox', 'chrome'];

export const LINK_APPS: Record<FeedType, LinkAppId[]> = {
  news: ['default', ...BROWSERS, 'custom'],
  video: ['default', 'newpipe', 'youtube', ...BROWSERS, 'custom'],
  podcast: ['default', 'antennapod', 'spotify', ...BROWSERS, 'custom'],
};

export const DEFAULT_LINK_APPS: LinkAppSettings = {
  news: { app: 'default' },
  video: { app: 'default' },
  podcast: { app: 'default' },
};

const PACKAGE_NAME = /^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)+$/;

export function isPackageName(value: string): boolean {
  return value.length <= 200 && PACKAGE_NAME.test(value);
}

/** Parses stored settings, dropping anything unknown so a stale or edited value never breaks links. */
export function parseLinkApps(raw: string | null): LinkAppSettings {
  const settings: LinkAppSettings = structuredClone(DEFAULT_LINK_APPS);
  if (!raw) return settings;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return settings;
  }
  if (!data || typeof data !== 'object') return settings;
  for (const type of Object.keys(LINK_APPS) as FeedType[]) {
    const choice = (data as Record<string, unknown>)[type] as Partial<LinkAppChoice> | undefined;
    if (!choice || !LINK_APPS[type].includes(choice.app as LinkAppId)) continue;
    if (choice.app === 'custom') {
      if (typeof choice.package === 'string' && isPackageName(choice.package)) {
        settings[type] = { app: 'custom', package: choice.package };
      }
    } else {
      settings[type] = { app: choice.app as LinkAppId };
    }
  }
  return settings;
}

/** `intent://` URL that opens an http(s) `target` in `pkg`, or loads `fallback` when the app is missing. */
export function intentUrl(target: string, pkg: string, fallback: string): string {
  const url = new URL(target);
  const scheme = url.protocol.slice(0, -1);
  return `intent://${url.host}${url.pathname}${url.search}#Intent;scheme=${scheme};package=${pkg};S.browser_fallback_url=${encodeURIComponent(fallback)};end`;
}

function isHttp(value: string): boolean {
  try {
    return ['http:', 'https:'].includes(new URL(value).protocol);
  } catch {
    return false;
  }
}

export interface ItemLink {
  href: string;
  /** True when the link hands off to an Android app instead of opening a page. */
  app: boolean;
}

export function itemLink(
  item: Pick<FeedItem, 'type' | 'url' | 'title' | 'sourceUrl'>,
  settings: LinkAppSettings,
  android: boolean,
): ItemLink | null {
  if (!item.url) return null;
  const page = { href: item.url, app: false };
  const choice = settings[item.type];
  if (!android || choice.app === 'default' || !isHttp(item.url)) return page;
  const pkg = choice.app === 'custom' ? choice.package : PACKAGE[choice.app];
  if (!pkg) return page;
  if (choice.app === 'spotify') {
    const search = `https://open.spotify.com/search/${encodeURIComponent(item.title)}`;
    return { href: intentUrl(search, pkg, search), app: true };
  }
  if (choice.app === 'antennapod') {
    // AntennaPod opens feeds, not episode pages: show the podcast with its episode list.
    if (!isHttp(item.sourceUrl)) return page;
    const feed = `https://antennapod.org/deeplink/subscribe?url=${encodeURIComponent(item.sourceUrl)}`;
    return { href: intentUrl(feed, pkg, item.url), app: true };
  }
  return { href: intentUrl(item.url, pkg, item.url), app: true };
}
