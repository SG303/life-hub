<script lang="ts">
  import { api, type BookmarkExpiryDays, type FeedItem, type ItemStatePatch } from '../lib/api';
  import { ago, TYPE_SINGULAR } from '../lib/format';
  import { askAgent } from '../lib/router.svelte';
  import Icon from './Icon.svelte';
  import SwipeRow from './SwipeRow.svelte';

  let {
    item,
    compact = false,
    bookmarkedView = false,
    defaultExpiryDays = 14,
    swipeOpen = false,
    onswipeopen,
    onswiperight,
    ontask,
    onrelease,
    onchange,
  }: {
    item: FeedItem;
    compact?: boolean;
    bookmarkedView?: boolean;
    defaultExpiryDays?: BookmarkExpiryDays;
    swipeOpen?: boolean;
    onswipeopen?: (open: boolean) => void;
    onswiperight?: (item: FeedItem) => void;
    ontask?: (item: FeedItem) => void;
    onrelease?: (item: FeedItem) => void;
    onchange: (item: FeedItem) => void;
  } = $props();

  let error = $state('');

  const expired = $derived(!compact && item.bookmarked && item.bookmarkExpired);
  const showPermanentToggle = $derived(
    !compact && bookmarkedView && item.bookmarked && !item.bookmarkExpired && (item.bookmarkExpiresAt !== null || defaultExpiryDays !== null),
  );

  async function update(state: ItemStatePatch) {
    error = '';
    try {
      onchange(await api.updateItem(item.id, state));
    } catch (e) {
      error = (e as Error).message;
    }
  }

  function opened() {
    if (!item.read) void update({ read: true });
  }
</script>

{#snippet inner()}
  <div class="body">
    <p class="meta">
      {#if expired}<span class="expired-badge">Abgelaufen</span>{/if}
      {#if !compact}<span class="type {item.type}">{TYPE_SINGULAR[item.type]}</span>{/if}
      <span>{item.sourceTitle}</span>
      <span>{ago(item.publishedAt ?? item.fetchedAt)}</span>
    </p>
    {#if item.url}
      <a class="title" href={item.url} target="_blank" rel="noopener noreferrer" onclick={opened} onauxclick={opened}>
        {item.title}<span class="external"><Icon name="external" size={15} /></span>
      </a>
    {:else}
      <p class="title">{item.title}</p>
    {/if}
    {#if item.summary && !compact}<p class="summary">{item.summary}</p>{/if}
    {#if error}<p class="notice error" role="alert">{error}</p>{/if}
  </div>
  {#if expired}
    <div class="review-actions">
      <button
        class="button primary small"
        type="button"
        title={defaultExpiryDays ? `Um ${defaultExpiryDays} Tage verlängern` : 'Dauerhaft behalten'}
        onclick={() => update({ bookmarkExpiry: 'extend' })}
      >
        Verlängern
      </button>
      <button class="button small" type="button" onclick={() => update({ bookmarkExpiry: 'permanent' })}>Dauerhaft</button>
      <button
        class="button small danger"
        type="button"
        onclick={() => (onrelease ? onrelease(item) : void update({ bookmarked: false, read: true }))}
      >
        Loslassen
      </button>
    </div>
  {/if}
  <div class="actions">
    {#if !compact}
      <button class="button quiet" type="button" onclick={() => update({ read: !item.read })}>
        <Icon name="read" size={18} /><span>{item.read ? 'Als ungelesen markieren' : 'Als gelesen markieren'}</span>
      </button>
    {/if}
    {#if !expired}
      <button
        class="button quiet"
        class:marked={item.bookmarked}
        type="button"
        aria-pressed={item.bookmarked}
        onclick={() => update({ bookmarked: !item.bookmarked })}
      >
        <Icon name="bookmark" size={18} filled={item.bookmarked} /><span>Merken</span>
      </button>
    {/if}
    {#if showPermanentToggle}
      <button
        class="button quiet keep-label"
        class:marked={item.bookmarkExpiresAt === null}
        type="button"
        aria-pressed={item.bookmarkExpiresAt === null}
        onclick={() => update({ bookmarkExpiry: item.bookmarkExpiresAt === null ? 'extend' : 'permanent' })}
      >
        <Icon name="pin" size={17} /><span>Dauerhaft</span>
      </button>
    {/if}
    {#if !compact && ontask}
      <button class="button quiet" type="button" onclick={() => ontask(item)}>
        <Icon name="tasks" size={18} /><span>Aufgabe</span>
      </button>
    {/if}
    <button class="button quiet" type="button" onclick={() => askAgent('feed_item', item.id)}>
      <Icon name="agent" size={18} /><span>Agent fragen</span>
    </button>
  </div>
{/snippet}

{#if compact}
  <li class="entry compact" class:read={item.read} data-testid="feed-item" data-type={item.type}>
    {@render inner()}
  </li>
{:else}
  <SwipeRow
    testid="feed-item"
    dataType={item.type}
    open={swipeOpen}
    onopen={onswipeopen}
    right={{
      label: item.read ? 'Ungelesen' : 'Gelesen',
      icon: 'read',
      onclick: () => (onswiperight ? onswiperight(item) : void update({ read: !item.read })),
    }}
    left={[
      {
        label: 'Merken',
        icon: 'bookmark',
        tone: 'neutral',
        pressed: item.bookmarked,
        filled: item.bookmarked,
        onclick: () => void update({ bookmarked: !item.bookmarked }),
      },
      ...(ontask
        ? [
            {
              label: 'Aufgabe',
              icon: 'tasks',
              tone: 'accent' as const,
              onclick: () => ontask(item),
            },
          ]
        : []),
    ]}
  >
    <div class="entry" class:read={item.read} class:expired data-expired={expired ? 'true' : undefined}>
      {@render inner()}
    </div>
  </SwipeRow>
{/if}

<style>
  .entry {
    padding: 0.9rem 1.25rem;
  }

  .entry.expired {
    background: var(--warn-wash);
  }

  .meta {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.25rem 0.75rem;
    margin: 0 0 0.2rem;
  }

  .expired-badge {
    padding: 0.05rem 0.55rem;
    border-radius: 999px;
    background: var(--badge);
    color: var(--badge-ink);
    font-weight: 650;
  }

  .review-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.45rem;
    margin-top: 0.65rem;
  }

  .type {
    font-weight: 650;
    color: var(--accent);
  }

  .title {
    display: block;
    margin: 0;
    color: var(--ink);
    font-weight: 650;
    font-size: 1.1875rem;
    line-height: 1.25;
    text-decoration: none;
    overflow-wrap: anywhere;
  }

  a.title:hover {
    text-decoration: underline;
    text-decoration-color: var(--accent);
  }

  .external {
    display: inline-block;
    margin-left: 0.3rem;
    color: var(--soft);
    vertical-align: -0.1em;
  }

  .read .title {
    color: var(--soft);
    font-weight: 500;
  }

  .summary {
    margin: 0.35rem 0 0;
    max-width: 68ch;
    color: var(--soft);
    white-space: pre-line;
    overflow-wrap: anywhere;
    display: -webkit-box;
    -webkit-line-clamp: 4;
    line-clamp: 4;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.15rem;
    margin: 0.4rem 0 0 -0.7rem;
  }

  .marked {
    color: var(--accent);
  }

  /* Compact (Heute): a card on a shelf, actions as icon buttons at the bottom. */
  /* position: relative keeps the hidden button labels inside the card, so a swiped-off card cannot widen the page. */
  .compact {
    position: relative;
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
    min-height: 10.5rem;
    padding: 1rem 1rem 0.5rem;
    border: 0;
    border-radius: var(--radius-m);
    background: var(--surface);
    scroll-snap-align: start;
  }

  .compact .title {
    display: -webkit-box;
    -webkit-line-clamp: 3;
    line-clamp: 3;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  .compact .external {
    display: none;
  }

  .compact .actions {
    margin: auto -0.4rem 0 auto;
  }

  .compact .actions :global(.button) {
    width: 2.75rem;
    padding: 0;
    justify-content: center;
  }

  .compact .actions span {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
  }

  @media (max-width: 520px) {
    .actions button:not(.keep-label) span {
      position: absolute;
      width: 1px;
      height: 1px;
      overflow: hidden;
      clip-path: inset(50%);
    }
  }
</style>
