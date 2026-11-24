<script lang="ts">
  import FeedEntry from '../components/FeedEntry.svelte';
  import TaskItem from '../components/TaskItem.svelte';
  import { api, type Cockpit, type FeedType } from '../lib/api';
  import { longDate, TYPE_LABEL } from '../lib/format';
  import { router } from '../lib/router.svelte';

  let cockpit = $state<Cockpit | undefined>();
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
  });

  const heading = $derived(cockpit ? longDate(cockpit.tasks.today) : undefined);
  const dueCount = $derived(cockpit ? cockpit.tasks.overdue.length + cockpit.tasks.dueToday.length : 0);
  const types: FeedType[] = ['news', 'video', 'podcast'];

  function go(event: MouseEvent, path: string) {
    event.preventDefault();
    router.go(path);
  }
</script>

<header class="hero">
  {#if heading}
    <h1><span class="weekday">{heading.weekday}</span><span class="date">{heading.date}</span></h1>
    <p class="lead">
      {#if dueCount === 0}
        Heute ist nichts fällig.
      {:else if dueCount === 1}
        1 Aufgabe ist heute fällig oder überfällig.
      {:else}
        {dueCount} Aufgaben sind heute fällig oder überfällig.
      {/if}
    </p>
  {:else}
    <h1><span class="weekday">Heute</span></h1>
  {/if}
</header>

{#if error}
  <p class="notice error" role="alert">{error}</p>
{/if}

{#if cockpit}
  <div class="columns">
    <section aria-labelledby="h-tasks">
      <div class="section-head">
        <h2 id="h-tasks">Aufgaben</h2>
        <a href="/aufgaben" onclick={(e) => go(e, '/aufgaben')}>Alle {cockpit.tasks.openCount} offenen</a>
      </div>

      {#if cockpit.tasks.overdue.length}
        <h3 class="group overdue">Überfällig</h3>
        <ul class="list">
          {#each cockpit.tasks.overdue as task (task.id)}
            <TaskItem {task} today={cockpit.tasks.today} compact onchange={load} />
          {/each}
        </ul>
      {/if}

      {#if cockpit.tasks.dueToday.length}
        <h3 class="group">Heute fällig</h3>
        <ul class="list">
          {#each cockpit.tasks.dueToday as task (task.id)}
            <TaskItem {task} today={cockpit.tasks.today} compact onchange={load} />
          {/each}
        </ul>
      {/if}

      {#if cockpit.tasks.upcoming.length}
        <h3 class="group">Als Nächstes</h3>
        <ul class="list">
          {#each cockpit.tasks.upcoming as task (task.id)}
            <TaskItem {task} today={cockpit.tasks.today} compact onchange={load} />
          {/each}
        </ul>
      {/if}

      {#if cockpit.tasks.openCount === 0}
        <p class="empty">Keine offenen Aufgaben. <a href="/aufgaben" onclick={(e) => go(e, '/aufgaben')}>Aufgabe erfassen</a></p>
      {/if}
    </section>

    <section aria-labelledby="h-feeds">
      <div class="section-head">
        <h2 id="h-feeds">Neu in deinen Feeds</h2>
        <a href="/feeds" onclick={(e) => go(e, '/feeds')}>Zu den Feeds</a>
      </div>
      {#each types as type (type)}
        {@const group = cockpit.feeds[type]}
        <div class="feed-group" data-testid="today-{type}">
          <h3 class="group">
            {TYPE_LABEL[type]}
            <span class="count">{group.unreadCount} ungelesen</span>
          </h3>
          {#if group.items.length}
            <ul class="list">
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

<style>
  .hero {
    position: relative;
    margin: 0 0 2rem;
    padding: 0.5rem 0 4.5rem;
  }

  /* The one decorative element: contour lines, tinted via mask so they follow the theme. */
  .hero::after {
    content: '';
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    height: 4rem;
    background: var(--lake);
    opacity: 0.4;
    mask: url('/contours.svg') center / 100% 100% no-repeat;
  }

  h1 {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 0 1rem;
  }

  .weekday {
    font-size: var(--step-3);
    font-weight: 820;
    font-stretch: 68%;
    letter-spacing: -0.02em;
  }

  .date {
    font-size: var(--step-2);
    font-weight: 500;
    font-stretch: 85%;
    color: var(--ink-soft);
  }

  .lead {
    margin: 0.5rem 0 0;
    font-size: var(--step-1);
    max-width: 40ch;
  }

  .columns {
    display: grid;
    gap: 2.5rem;
  }

  .section-head {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    justify-content: space-between;
    gap: 0.5rem;
    padding-bottom: 0.4rem;
    border-bottom: 2px solid var(--ink);
  }

  .section-head a {
    font-weight: 560;
  }

  .group {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    margin-top: 1.25rem;
    color: var(--ink-soft);
  }

  .group.overdue {
    color: var(--contour);
  }

  .count {
    font-size: var(--step--1);
    font-weight: 500;
    font-stretch: 100%;
  }

  .list {
    margin: 0;
    padding: 0;
    list-style: none;
  }

  @media (min-width: 1100px) {
    .columns {
      grid-template-columns: 1fr 1fr;
      gap: 3.5rem;
    }
  }
</style>
