<script lang="ts">
  import FeedEntry from '../components/FeedEntry.svelte';
  import Icon from '../components/Icon.svelte';
  import TaskCreateSheet from '../components/TaskCreateSheet.svelte';
  import TaskItem from '../components/TaskItem.svelte';
  import UndoToast from '../components/UndoToast.svelte';
  import { api, type Cockpit, type FeedItem, type FeedType } from '../lib/api';
  import { TYPE_LABEL } from '../lib/format';
  import { router } from '../lib/router.svelte';
  import { taskDraftFromFeedItem } from '../lib/swipe';

  let cockpit = $state<Cockpit | undefined>();
  let agent = $state<{ configured: boolean; reachable: boolean | null } | undefined>();
  let error = $state('');
  let undo = $state<{ id: number; message: string; onundo: () => Promise<void> } | undefined>();
  let undoSeq = 0;
  let taskSheetOpen = $state(false);
  let taskSourceItem = $state<FeedItem | undefined>();
  let taskCategories = $state<string[]>([]);

  async function load() {
    try {
      cockpit = await api.cockpit();
      error = '';
    } catch (e) {
      error = (e as Error).message;
    }
  }

  $effect(() => {
    void load();
    api.agentStatus().then((s) => (agent = s), () => (agent = undefined));
  });

  const due = $derived(cockpit ? [...cockpit.tasks.overdue, ...cockpit.tasks.dueToday] : []);
  const expiredBookmarks = $derived(cockpit?.feeds.expiredBookmarks);
  const STATE_LABEL = { up: 'erreichbar', down: 'nicht erreichbar', off: 'nicht konfiguriert' } as const;
  const types: FeedType[] = ['news', 'video', 'podcast'];
  const TYPE_ICON: Record<FeedType, string> = { news: 'feeds', video: 'play', podcast: 'listen' };

  function go(event: MouseEvent, path: string) {
    event.preventDefault();
    router.go(path);
  }

  async function markRead(item: FeedItem) {
    if (item.read) return;
    try {
      await api.updateItem(item.id, { read: true });
      await load();
    } catch (e) {
      error = (e as Error).message;
    }
  }

  async function extendBookmark(item: FeedItem) {
    error = '';
    try {
      await api.updateItem(item.id, { bookmarkExpiry: 'extend' });
      await load();
    } catch (e) {
      error = (e as Error).message;
    }
  }

  async function keepPermanent(item: FeedItem) {
    error = '';
    try {
      await api.updateItem(item.id, { bookmarkExpiry: 'permanent' });
      await load();
    } catch (e) {
      error = (e as Error).message;
    }
  }

  async function releaseBookmark(item: FeedItem) {
    error = '';
    const previousRead = item.read;
    const previousExpiresAt = item.bookmarkExpiresAt;
    try {
      await api.updateItem(item.id, { bookmarked: false, read: true });
      await load();
      const token = ++undoSeq;
      undo = {
        id: token,
        message: 'Lesezeichen losgelassen',
        onundo: async () => {
          try {
            await api.updateItem(item.id, {
              bookmarked: true,
              read: previousRead,
              bookmarkExpiry: previousExpiresAt,
            });
            await load();
          } catch (e) {
            error = (e as Error).message;
          }
        },
      };
    } catch (e) {
      error = (e as Error).message;
    }
  }

  function openTaskSheet(item: FeedItem) {
    taskSourceItem = item;
    taskSheetOpen = true;
    api.categories().then(
      (res) => (taskCategories = res.items),
      () => undefined,
    );
  }

  async function taskCreated() {
    const sourceItem = taskSourceItem;
    taskSourceItem = undefined;
    if (sourceItem && !sourceItem.read) {
      try {
        await api.updateItem(sourceItem.id, { read: true });
      } catch (e) {
        error = (e as Error).message;
      }
    }
    await load();
  }
</script>

<header class="top">
  <h1 class="brand">Life Hub<span class="visually-hidden">: Heute</span></h1>
  {#if agent}
    {@const state = !agent.configured ? 'off' : agent.reachable ? 'up' : 'down'}
    <p class="agent {state}" title={STATE_LABEL[state]}>
      Agent<span class="visually-hidden">: {STATE_LABEL[state]}</span>
    </p>
  {/if}
</header>

{#if error}
  <p class="notice error" role="alert">{error}</p>
{/if}

{#if cockpit}
  <div class="layout">
    <div class="left">
      <section class="sheet slab" aria-labelledby="h-due">
        <div class="slab-head">
          <h2 id="h-due">Heute fällig</h2>
          {#if due.length}<span class="meta">{due.length} offen</span>{/if}
        </div>
        {#if due.length}
          <ul class="list">
            {#each due as task (task.id)}
              <TaskItem {task} today={cockpit.tasks.today} compact onchange={load} />
            {/each}
          </ul>
        {:else}
          <p class="empty">Heute ist nichts fällig.</p>
        {/if}
        <a class="more" href="/aufgaben" onclick={(e) => go(e, '/aufgaben')}>
          {cockpit.tasks.openCount === 0
            ? 'Aufgabe erfassen'
            : cockpit.tasks.openCount === 1
              ? '1 offene Aufgabe'
              : `Alle ${cockpit.tasks.openCount} offenen Aufgaben`}
        </a>
      </section>

      {#if cockpit.tasks.upcoming.length}
        <section class="sheet next" aria-labelledby="h-next">
          <h2 id="h-next">Als Nächstes</h2>
          <ul class="list">
            {#each cockpit.tasks.upcoming as task (task.id)}
              <TaskItem {task} today={cockpit.tasks.today} compact onchange={load} />
            {/each}
          </ul>
        </section>
      {/if}
    </div>

    <section class="right" aria-labelledby="h-feeds">
      {#if expiredBookmarks && expiredBookmarks.total > 0}
        <section class="sheet review" aria-labelledby="h-review" data-testid="expired-bookmarks">
          <div class="slab-head">
            <h2 id="h-review">Lesezeichen prüfen</h2>
            <span class="expired-count">{expiredBookmarks.total} abgelaufen</span>
          </div>
          <ul class="list">
            {#each expiredBookmarks.items as item (item.id)}
              <li class="review-item" data-testid="expired-bookmark">
                <p class="meta">{item.sourceTitle}</p>
                {#if item.url}
                  <a
                    class="review-title"
                    href={item.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    onclick={() => void markRead(item)}
                    onauxclick={() => void markRead(item)}
                  >
                    {item.title}<span class="external"><Icon name="external" size={14} /></span>
                  </a>
                {:else}
                  <p class="review-title">{item.title}</p>
                {/if}
                <div class="review-actions">
                  <button
                    class="button primary small"
                    type="button"
                    title={expiredBookmarks.defaultExpiryDays
                      ? `Um ${expiredBookmarks.defaultExpiryDays} Tage verlängern`
                      : 'Dauerhaft behalten'}
                    onclick={() => extendBookmark(item)}
                  >
                    Verlängern
                  </button>
                  <button class="button small" type="button" onclick={() => keepPermanent(item)}>Dauerhaft</button>
                  <button class="button small danger" type="button" onclick={() => releaseBookmark(item)}>Loslassen</button>
                  <button class="button quiet small" type="button" onclick={() => openTaskSheet(item)}>
                    <Icon name="tasks" size={16} />Aufgabe
                  </button>
                </div>
              </li>
            {/each}
          </ul>
          {#if expiredBookmarks.total > expiredBookmarks.items.length}
            <a class="more" href="/feeds?gemerkt=1" onclick={(e) => go(e, '/feeds?gemerkt=1')}>
              Alle {expiredBookmarks.total} in «Gemerkt» ansehen
            </a>
          {/if}
        </section>
      {/if}

      <div class="feeds-head">
        <h2 id="h-feeds">Neu in deinen Feeds</h2>
        <a href="/feeds" onclick={(e) => go(e, '/feeds')}>Zu den Feeds</a>
      </div>
      {#each types as type (type)}
        {@const group = cockpit.feeds[type]}
        <div class="shelf" data-testid="today-{type}">
          <h3>
            <span class="badge" aria-hidden="true"><Icon name={TYPE_ICON[type]} size={18} /></span>
            {TYPE_LABEL[type]}
            <span class="count">{group.unreadCount} ungelesen</span>
          </h3>
          {#if group.items.length}
            <ul class="cards">
              {#each group.items as item (item.id)}
                <FeedEntry {item} compact onchange={load} />
              {/each}
            </ul>
          {:else}
            <p class="empty">Nichts Neues.</p>
          {/if}
        </div>
      {/each}
    </section>
  </div>
{/if}

<TaskCreateSheet
  bind:open={taskSheetOpen}
  categories={taskCategories}
  initial={taskSourceItem ? taskDraftFromFeedItem(taskSourceItem) : undefined}
  oncreated={taskCreated}
/>

{#if undo}
  <UndoToast id={undo.id} message={undo.message} onundo={undo.onundo} ondismiss={() => (undo = undefined)} />
{/if}

<style>
  .top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    margin-bottom: 1.25rem;
  }

  .brand {
    font-size: 1.0625rem;
    font-stretch: 100%;
    font-weight: 700;
    line-height: 1.45;
  }

  .agent {
    display: inline-flex;
    align-items: center;
    gap: 0.45rem;
    margin: 0;
    padding: 0.3rem 0.75rem;
    border-radius: 999px;
    background: var(--surface);
    color: var(--soft);
    font-size: var(--step--1);
  }

  /* The dot carries the state: olive = reachable, ochre ring = down, grey ring = not configured. */
  .agent::before {
    content: '';
    width: 0.55rem;
    height: 0.55rem;
    border-radius: 50%;
    background: var(--accent);
  }

  .agent.down::before {
    background: transparent;
    box-shadow: inset 0 0 0 2px var(--warn);
  }

  .agent.off::before {
    background: transparent;
    box-shadow: inset 0 0 0 2px var(--soft);
  }

  .slab {
    padding-top: 1.1rem;
  }

  .slab-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 1rem;
    margin-bottom: 0.4rem;
  }

  .slab-head .meta {
    font-size: var(--step-0);
  }

  .list {
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .more {
    display: block;
    margin: 0.25rem -0.5rem 0;
    padding: 0.8rem 0.5rem;
    border-top: 1px solid var(--line);
    font-weight: 600;
    text-decoration: none;
  }

  .more:hover {
    text-decoration: underline;
  }

  .next {
    margin-top: 1rem;
    padding-top: 1rem;
  }

  .next h2 {
    font-size: 1.125rem;
    margin-bottom: 0.25rem;
  }

  .review {
    margin: 2rem 0 1.75rem;
    padding-top: 1.1rem;
  }

  .review h2 {
    font-size: 1.25rem;
  }

  .expired-count {
    padding: 0.1rem 0.6rem;
    border-radius: 999px;
    background: var(--badge);
    color: var(--badge-ink);
    font-size: var(--step--1);
    font-weight: 650;
  }

  .review-item {
    padding: 0.85rem 0;
    border-top: 1px solid var(--line);
  }

  .review-item .meta {
    margin: 0 0 0.15rem;
  }

  .review-title {
    display: block;
    margin: 0;
    color: var(--ink);
    font-weight: 650;
    line-height: 1.3;
    text-decoration: none;
    overflow-wrap: anywhere;
  }

  a.review-title:hover {
    text-decoration: underline;
    text-decoration-color: var(--accent);
  }

  .external {
    display: inline-block;
    margin-left: 0.3rem;
    color: var(--soft);
    vertical-align: -0.1em;
  }

  .review-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.45rem;
    margin-top: 0.6rem;
  }

  .feeds-head {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    justify-content: space-between;
    gap: 0.5rem 1rem;
    margin: 2.25rem 0 0;
  }

  .feeds-head h2 {
    font-size: 1.75rem;
  }

  .feeds-head a {
    font-weight: 600;
    text-decoration: none;
  }

  .shelf {
    margin-top: 1.25rem;
  }

  h3 {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    margin-bottom: 0.7rem;
  }

  .badge {
    display: grid;
    place-items: center;
    width: 2.1rem;
    height: 2.1rem;
    border-radius: 50%;
    background: var(--surface);
    color: var(--accent);
  }

  .count {
    color: var(--soft);
    font-size: var(--step-0);
    font-weight: 450;
  }

  /* Phones: each feed type is a shelf of cards you swipe through. */
  .cards {
    display: grid;
    grid-auto-flow: column;
    grid-auto-columns: 78%;
    gap: 0.75rem;
    margin: 0 -1rem;
    padding: 0 1rem 0.25rem;
    list-style: none;
    overflow-x: auto;
    scroll-snap-type: x mandatory;
    scroll-padding-inline: 1rem;
    scrollbar-width: none;
  }

  @media (min-width: 1000px) {
    .layout {
      display: grid;
      grid-template-columns: 26rem minmax(0, 1fr);
      gap: 3rem;
      align-items: start;
    }

    .left {
      position: sticky;
      top: 1.75rem;
    }

    /* Line the right column up with the top of the slab. */
    .review {
      margin-top: 0;
    }

    .feeds-head {
      margin-top: 0;
    }

    .cards {
      grid-auto-flow: row;
      grid-template-columns: repeat(auto-fill, minmax(14rem, 1fr));
      margin: 0;
      padding: 0;
      overflow: visible;
    }
  }
</style>
