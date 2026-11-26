import type { FeedItem, FeedType } from './api';
import { itemLink, parseLinkApps, type ItemLink, type LinkAppChoice } from './linkApps';

const KEY = 'life-hub.link-apps';

function read(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

/** This device's link app settings; stored in the browser because installed apps differ per device. */
export const linkApps = $state(parseLinkApps(read()));

export const isAndroid = typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent);

export function setLinkApp(type: FeedType, choice: LinkAppChoice): void {
  linkApps[type] = choice;
  try {
    localStorage.setItem(KEY, JSON.stringify(linkApps));
  } catch {
    // Private mode or blocked storage: the choice still applies until the page reloads.
  }
}

export function linkFor(item: Pick<FeedItem, 'type' | 'url' | 'title' | 'sourceUrl'>): ItemLink | null {
  return itemLink(item, linkApps, isAndroid);
}
