<script lang="ts">
  import FeedEntry from '../components/FeedEntry.svelte';
  import Icon from '../components/Icon.svelte';
  import Sheet from '../components/Sheet.svelte';
  import SourceForm from '../components/SourceForm.svelte';
  import { api, type FeedItem, type FeedSource, type FeedType } from '../lib/api';

  const PAGE = 50;
  const TYPES: { value: FeedType | ''; label: string }[] = [
    { value: '', label: 'Alle' },
    { value: 'news', label: 'News' },
    { value: 'video', label: 'Videos' },
    { value: 'podcast', label: 'Podcasts' },
  ];

  let type = $state<FeedType | ''>('');
  let unread = $state(true);
  let bookmarked = $state(false);
  let items = $state<FeedItem[]>([]);
  let total = $state(0);
  let loaded = $state(false);
  let refreshing = $state(false);
  let message = $state('');
  let error = $state('');
  let hasSources = $state(true);
  let addingSource = $state(false);
  let request = 0;

  // Items toggled out of the filter (e.g. read under «Ungelesen») stay visible so the toggle can be
  // undone, but they are no longer part of the server's result set: paging counts only matching items.
  const matches = (item: FeedItem) => (!unread || !item.read) && (!bookmarked || item.bookmarked);
  const matching = $derived(items.filter(matches).length);

  async function load(append = false) {
    const current = ++request;
    try {
      const result = await api.items({
        type: type || undefined,
        unread,
        bookmarked,
        limit: PAGE,
        offset: append ? matching : 0,
      });
      if (current !== request) return; // a newer filter or reload superseded this response
      const known = new Set(items.map((item) => item.id));
      items = append ? [...items, ...result.items.filter((item) => !known.has(item.id))] : result.items;
      total = result.total;
      error = '';
      if (!append && result.total === 0) hasSources = (await api.sources()).items.length > 0;
    } catch (e) {
      error = (e as Error).message;
    } finally {
      loaded = true;
    }
  }

  $effect(() => {
    void type;
    void unread;
    void bookmarked;
    void load();
  });

  async function refresh() {
    refreshing = true;
    message = '';
    try {
      const result = await api.refresh();
      message =
        result.newItems === 1 ? '1 neuer Eintrag.' : result.newItems ? `${result.newItems} neue Einträge.` : 'Keine neuen Einträge.';
      if (result.failed) message += ` ${result.failed} Quelle(n) konnten nicht abgerufen werden.`;
      await load();
    } catch (e) {
      error = (e as Error).message;
    } finally {
      refreshing = false;
    }
  }

  async function markAllRead() {
    try {
      const result = await api.markAllRead(type || undefined);
      message = `${result.updated} als gelesen markiert.`;
      await load();
    } catch (e) {
      error = (e as Error).message;
    }
  }

  function sourceAdded(source: FeedSource) {
    addingSource = false;
    hasSources = true;
    message = `«${source.title}» abonniert: ${source.itemCount} Einträge, davon ${source.unreadCount} ungelesen.`;
    void load();
  }

  function updated(next: FeedItem) {
    const previous = items.find((item) => item.id === next.id);
    if (previous) total += Number(matches(next)) - Number(matches(previous));
    items = items.map((item) => (item.id === next.id ? next : item));
  }
</script>

<header class="page-head">
  <h1>Feeds</h1>
  <div class="toolbar">
    <button class="button icon" type="button" onclick={refresh} disabled={refreshing} aria-label="Aktualisieren" title="Aktualisieren">
      <span class="glyph" class:spin={refreshing}><Icon name="refresh" size={20} /></span>
    </button>
    <button class="button primary" type="button" onclick={() => (addingSource = true)}>
      <Icon name="plus" size={18} />Neue Quelle
    </button>
  </div>
</header>

<Sheet bind:open={addingSource} title="Neue Quelle">
  <SourceForm onadded={sourceAdded} />
</Sheet>

<div class="toolbar filters">
  <div class="segments" role="group" aria-label="Typ">
    {#each TYPES as option (option.value)}
      <button type="button" aria-pressed={type === option.value} onclick={() => (type = option.value)}>{option.label}</button>
    {/each}
  </div>
</div>

<div class="toolbar states">
  <button class="toggle" type="button" aria-pressed={unread} onclick={() => (unread = !unread)}>Ungelesen</button>
  <button class="toggle" type="button" aria-pressed={bookmarked} onclick={() => (bookmarked = !bookmarked)}>
    <Icon name="bookmark" size={16} filled={bookmarked} />Gemerkt
  </button>
  <button class="button quiet mark" type="button" onclick={markAllRead} title="Alle als gelesen markieren">
    <Icon name="check" size={18} />Alle gelesen
  </button>
</div>

<p class="status" role="status">{refreshing ? 'Wird aktualisiert …' : message}</p>
{#if error}<p class="notice error" role="alert">{error}</p>{/if}

{#if items.length}
  <ul class="sheet">
    {#each items as item (item.id)}
      <FeedEntry {item} onchange={updated} />
    {/each}
  </ul>
  {#if matching < total}
    <button class="button more" type="button" onclick={() => load(true)}>Weitere laden ({total - matching})</button>
  {/if}
{:else if loaded}
  {#if !hasSources}
    <p class="empty">
      Noch keine Quellen abonniert.
      <button class="link" type="button" onclick={() => (addingSource = true)}>Erste Quelle hinzufügen</button>
    </p>
  {:else}
    <p class="empty">{unread ? 'Alles gelesen.' : 'Keine Einträge für diesen Filter.'}</p>
  {/if}
{/if}

<style>
  .filters {
    margin-bottom: 0.5rem;
  }

  .mark {
    margin-left: auto;
    margin-right: -0.7rem;
  }

  .status {
    margin: 0.25rem 0 0.5rem;
    color: var(--soft);
    font-size: var(--step--1);
  }

  .more {
    margin-top: 1rem;
  }

  .icon {
    justify-content: center;
    width: 2.75rem;
    padding: 0;
  }

  .glyph {
    display: inline-flex;
  }

  .link {
    padding: 0;
    border: 0;
    background: none;
    color: var(--accent);
    font-weight: 600;
    text-decoration: underline;
    cursor: pointer;
  }

  .spin {
    display: inline-flex;
    animation: spin 1s linear infinite;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
</style>
