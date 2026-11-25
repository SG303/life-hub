/** Minimal History API router for the five top-level views. */

/** In dock order: the agent (Chat) sits in the middle. */
export const NAV = [
  { path: '/', label: 'Heute', icon: 'today' },
  { path: '/aufgaben', label: 'Aufgaben', icon: 'tasks' },
  { path: '/chat', label: 'Chat', icon: 'agent' },
  { path: '/feeds', label: 'Feeds', icon: 'feeds' },
  { path: '/quellen', label: 'Quellen', icon: 'sources' },
] as const;

let location = $state({ path: window.location.pathname, search: window.location.search });

window.addEventListener('popstate', () => {
  location = { path: window.location.pathname, search: window.location.search };
});

export const router = {
  get path(): string {
    return location.path;
  },
  get params(): URLSearchParams {
    // A fresh read-only snapshot; reactivity comes from `location`.
    // eslint-disable-next-line svelte/prefer-svelte-reactivity
    return new URLSearchParams(location.search);
  },
  go(to: string, options: { replace?: boolean } = {}): void {
    // eslint-disable-next-line svelte/prefer-svelte-reactivity
    const url = new URL(to, window.location.origin);
    if (options.replace) history.replaceState(null, '', url);
    else history.pushState(null, '', url);
    location = { path: url.pathname, search: url.search };
    if (!options.replace) window.scrollTo(0, 0);
  },
};

/** Opens the chat composer with a snapshot of a task or feed item. */
export function askAgent(type: 'task' | 'feed_item', id: number): void {
  router.go(`/chat?kontext=${type}:${id}`);
}
