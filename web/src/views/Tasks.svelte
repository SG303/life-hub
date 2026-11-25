<script lang="ts">
  import Icon from '../components/Icon.svelte';
  import TaskCreateSheet from '../components/TaskCreateSheet.svelte';
  import TaskItem from '../components/TaskItem.svelte';
  import UndoToast from '../components/UndoToast.svelte';
  import { api, type Task } from '../lib/api';
  import { router } from '../lib/router.svelte';

  type Status = 'open' | 'done' | 'all';
  const STATUS: { value: Status; label: string }[] = [
    { value: 'open', label: 'Offen' },
    { value: 'done', label: 'Erledigt' },
    { value: 'all', label: 'Alle' },
  ];

  let status = $state<Status>('open');
  let category = $state('');
  let tasks = $state<Task[]>([]);
  let categories = $state<string[]>([]);
  let today = $state(new Date().toISOString().slice(0, 10));
  let loaded = $state(false);
  let error = $state('');
  let creating = $state(false);
  let openSwipeId = $state<number | null>(null);
  let undo = $state<{ id: number; message: string; onundo: () => Promise<void> } | undefined>();
  let undoSeq = 0;

  async function load() {
    try {
      const [list, cats] = await Promise.all([api.tasks({ status, category }), api.categories()]);
      tasks = list.items;
      categories = cats.items;
      today = list.today;
      if (category && !categories.includes(category)) category = '';
      error = '';
    } catch (e) {
      error = (e as Error).message;
    } finally {
      loaded = true;
    }
  }

  $effect(() => {
    void status;
    void category;
    openSwipeId = null;
    undo = undefined;
    void load();
  });

  // «Neue Aufgabe» from the home-screen shortcut: open the form once, then drop the flag
  // so a reload or «Zurück» does not open it again.
  if (router.params.has('neu')) {
    creating = true;
    router.go('/aufgaben', { replace: true });
  }

  async function swipeToggleDone(task: Task) {
    openSwipeId = null;
    error = '';
    const targetDone = !task.done;
    try {
      await api.updateTask(task.id, { done: targetDone });
      await load();
      const token = ++undoSeq;
      undo = {
        id: token,
        message: targetDone ? 'Aufgabe erledigt' : 'Aufgabe wieder geöffnet',
        onundo: async () => {
          try {
            await api.updateTask(task.id, { done: !targetDone });
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
</script>

<header class="page-head">
  <h1>Aufgaben</h1>
  <button class="button primary small" type="button" onclick={() => (creating = true)}><Icon name="plus" size={16} />Neue Aufgabe</button>
</header>

<TaskCreateSheet bind:open={creating} {categories} keepCategory oncreated={load} />

<div class="toolbar filters">
  <div class="segments" role="group" aria-label="Status">
    {#each STATUS as option (option.value)}
      <button type="button" aria-pressed={status === option.value} onclick={() => (status = option.value)}>{option.label}</button>
    {/each}
  </div>
  {#if categories.length}
    <label class="visually-hidden" for="category-filter">Liste</label>
    <select id="category-filter" class="input select" bind:value={category}>
      <option value="">Alle Listen</option>
      {#each categories as c (c)}<option value={c}>{c}</option>{/each}
    </select>
  {/if}
</div>

{#if error}<p class="notice error" role="alert">{error}</p>{/if}

{#if tasks.length}
  <ul class="sheet swipe-list">
    {#each tasks as task (task.id)}
      <TaskItem
        {task}
        {today}
        {categories}
        swipeOpen={openSwipeId === task.id}
        onswipeopen={(isOpen) => (openSwipeId = isOpen ? task.id : openSwipeId === task.id ? null : openSwipeId)}
        onswiperight={swipeToggleDone}
        onchange={load}
      />
    {/each}
  </ul>
{:else if loaded}
  <p class="empty">
    {status === 'done' ? 'Noch nichts erledigt.' : 'Keine offenen Aufgaben. Mit «Neue Aufgabe» eine erfassen.'}
  </p>
{/if}

{#if undo}
  <UndoToast id={undo.id} message={undo.message} onundo={undo.onundo} ondismiss={() => (undo = undefined)} />
{/if}

<style>
  .filters {
    margin-bottom: 0.5rem;
  }

  .select {
    width: auto;
    min-height: 2.5rem;
    border-radius: 999px;
  }
</style>
