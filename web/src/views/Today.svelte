<script lang="ts">
  import FeedEntry from '../components/FeedEntry.svelte';
  import Icon from '../components/Icon.svelte';
  import TaskItem from '../components/TaskItem.svelte';
  import { api, type Cockpit, type FeedType } from '../lib/api';
  import { longDate, TYPE_LABEL } from '../lib/format';
  import { router } from '../lib/router.svelte';

  let cockpit = $state<Cockpit | undefined>();
  let agent = $state<{ configured: boolean; reachable: boolean | null } | undefined>();
  let error = $state('');

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

  const heading = $derived(cockpit ? longDate(cockpit.tasks.today) : undefined);
  const due = $derived(cockpit ? [...cockpit.tasks.overdue, ...cockpit.tasks.dueToday] : []);
  const types: FeedType[] = ['news', 'video', 'podcast'];
  const TYPE_ICON: Record<FeedType, string> = { news: 'feeds', video: 'play', podcast: 'listen' };

  function go(event: MouseEvent, path: string) {
    event.preventDefault();
    router.go(path);
  }
</script>

<header class="top">
  <p class="brand">Life Hub</p>
  {#if agent}
    <p class="agent" class:down={agent.configured && !agent.reachable}>
      {#if !agent.configured}
        Kein Agent konfiguriert
      {:else}
        Agent {agent.reachable ? 'erreichbar' : 'nicht erreichbar'}
      {/if}
    </p>
  {/if}
</header>

{#if error}
  <p class="notice error" role="alert">{error}</p>
{/if}

{#if cockpit}
  <div class="layout">
    <div class="left">
      <div class="day">
        <p class="date">{heading?.date}</p>
        <h1>{heading?.weekday}</h1>
      </div>

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
{:else}
  <div class="day"><h1>Heute</h1></div>
{/if}

<style>
  .top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
  }

  .brand {
    margin: 0;
    font-weight: 700;
    font-size: 1.0625rem;
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

  .agent::before {
    content: '';
    width: 0.5rem;
    height: 0.5rem;
    border-radius: 50%;
    background: var(--accent);
  }

  .agent.down::before {
    background: var(--warn);
  }

  .day {
    margin: 1.5rem 0 1.25rem;
  }

  .date {
    margin: 0 0 0.2rem;
    color: var(--soft);
    font-size: 1.125rem;
    font-weight: 500;
  }

  h1 {
    font-size: var(--step-4);
    font-weight: 760;
    line-height: 0.86;
    letter-spacing: -0.012em;
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

    /* Line the feeds heading up with the top of the slab. */
    .feeds-head {
      margin-top: calc(1.5rem + 1.125rem * 1.45 + 0.2rem + var(--step-4) * 0.86 + 1.25rem);
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
