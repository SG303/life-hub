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
    <button class="button quiet" type="button" onclick={() => askAgent('feed_item', item.id)}>
      <Icon name="agent" size={18} /><span>Agent fragen</span>
    </button>
  </div>
</li>

<style>
  .entry {
    padding: 0.9rem 0;
    border-bottom: 1px solid var(--rule);
  }

  .meta {
    display: flex;
    flex-wrap: wrap;
    gap: 0.2rem 0.75rem;
    margin: 0 0 0.2rem;
  }

  .type {
    font-weight: 650;
    color: var(--lake);
  }

  .title {
    display: block;
    margin: 0;
    color: var(--ink);
    font-weight: 640;
    font-size: 1.0625rem;
    line-height: 1.35;
    text-decoration: none;
    overflow-wrap: anywhere;
  }

  a.title:hover {
    text-decoration: underline;
    text-decoration-color: var(--lake);
  }

  .external {
    display: inline-block;
    margin-left: 0.3rem;
    color: var(--ink-soft);
    vertical-align: -0.1em;
  }

  .read .title {
    color: var(--ink-soft);
    font-weight: 480;
  }

  .summary {
    margin: 0.35rem 0 0;
    max-width: 68ch;
    color: var(--ink-soft);
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
    margin: 0.4rem 0 0 -0.6rem;
  }

  .marked {
    color: var(--lake);
  }

  /* Compact (Heute): the only action sits beside the title as an icon button instead of its own row. */
  .compact {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: center;
    gap: 0 0.5rem;
  }

  .compact .actions {
    margin: 0 -0.6rem 0 0;
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
