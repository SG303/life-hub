<script lang="ts">
  import { api, type FeedItem } from '../lib/api';
  import { ago, TYPE_SINGULAR } from '../lib/format';
  import { askAgent } from '../lib/router.svelte';
  import Icon from './Icon.svelte';

  let {
    item,
    compact = false,
    onchange,
  }: { item: FeedItem; compact?: boolean; onchange: (item: FeedItem) => void } = $props();

  let error = $state('');

  async function update(state: { read?: boolean; bookmarked?: boolean }) {
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

<li class="entry" class:read={item.read} class:compact data-testid="feed-item" data-type={item.type}>
  <div class="body">
    <p class="meta">
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
  <div class="actions">
    {#if !compact}
      <button
        class="button quiet"
        type="button"
        onclick={() => update({ read: !item.read })}
      >
        <Icon name="read" size={18} /><span>{item.read ? 'Als ungelesen markieren' : 'Als gelesen markieren'}</span>
      </button>
    {/if}
    <button
      class="button quiet"
      class:marked={item.bookmarked}
      type="button"
      aria-pressed={item.bookmarked}
      onclick={() => update({ bookmarked: !item.bookmarked })}
    >
      <Icon name="bookmark" size={18} filled={item.bookmarked} /><span>Merken</span>
    </button>
    <button class="button quiet" type="button" onclick={() => askAgent('feed_item', item.id)}>
      <Icon name="agent" size={18} /><span>Agent fragen</span>
    </button>
  </div>
</li>

<style>
  .entry {
    padding: 0.9rem 0;
    border-top: 1px solid var(--line);
  }

  .entry:first-child {
    border-top: 0;
  }

  .meta {
    display: flex;
    flex-wrap: wrap;
    gap: 0.2rem 0.75rem;
    margin: 0 0 0.2rem;
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
    .actions span {
      position: absolute;
      width: 1px;
      height: 1px;
      overflow: hidden;
      clip-path: inset(50%);
    }
  }
</style>
