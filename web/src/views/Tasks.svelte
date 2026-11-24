<script lang="ts">
  import Icon from '../components/Icon.svelte';
  import TaskItem from '../components/TaskItem.svelte';
  import { api, type Task } from '../lib/api';

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
  let draft = $state({ title: '', dueDate: '', category: '', note: '' });
  let showDetails = $state(false);
  let titleInput = $state<HTMLInputElement>();

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
    void load();
  });

  async function create(event: SubmitEvent) {
    event.preventDefault();
    const submitted = { ...draft };
    try {
      await api.createTask({
        title: submitted.title,
        dueDate: submitted.dueDate || null,
        category: submitted.category || null,
        note: submitted.note || null,
      });
      // Clear only what was saved, so typing during the request is not lost. The list stays for the next task.
      if (draft.title === submitted.title) draft.title = '';
      if (draft.dueDate === submitted.dueDate) draft.dueDate = '';
      if (draft.note === submitted.note) draft.note = '';
      showDetails = false;
      titleInput?.focus();
      await load();
    } catch (e) {
      error = (e as Error).message;
    }
  }
</script>

<header class="page-head">
  <h1>Aufgaben</h1>
</header>

<form class="composer" onsubmit={create} aria-label="Neue Aufgabe">
  <div class="main-row">
    <label class="visually-hidden" for="task-title">Neue Aufgabe</label>
    <input
      id="task-title"
      class="input"
      placeholder="Neue Aufgabe"
      bind:value={draft.title}
      bind:this={titleInput}
      required
      maxlength="200"
      autocomplete="off"
    />
    <button class="button primary" type="submit"><Icon name="plus" size={18} />Hinzufügen</button>
  </div>
  <div class="detail-row">
    <label class="field">Fällig<input class="input" type="date" bind:value={draft.dueDate} name="dueDate" /></label>
    <label class="field">Liste<input class="input" bind:value={draft.category} maxlength="60" list="new-task-categories" name="category" /></label>
    {#if showDetails}
      <label class="field note">Notiz<textarea class="input" bind:value={draft.note} maxlength="4000" name="note"></textarea></label>
    {:else}
      <button class="button quiet" type="button" onclick={() => (showDetails = true)}>Notiz hinzufügen</button>
    {/if}
  </div>
  <datalist id="new-task-categories">
    {#each categories as c (c)}<option value={c}></option>{/each}
  </datalist>
</form>

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
  <ul class="list">
    {#each tasks as task (task.id)}
      <TaskItem {task} {today} {categories} onchange={load} />
    {/each}
  </ul>
{:else if loaded}
  <p class="empty">
    {status === 'done' ? 'Noch nichts erledigt.' : 'Keine offenen Aufgaben. Oben eine neue erfassen.'}
  </p>
{/if}

<style>
  .composer {
    display: grid;
    gap: 0.75rem;
    padding: 1rem;
    margin-bottom: 1.5rem;
    border: 1px solid var(--rule);
    border-radius: var(--radius-m);
    background: var(--sheet);
  }

  .main-row {
    display: flex;
    gap: 0.5rem;
  }

  .main-row .input {
    flex: 1;
    font-size: var(--step-1);
  }

  .detail-row {
    display: flex;
    flex-wrap: wrap;
    align-items: end;
    gap: 0.75rem;
  }

  .detail-row .field {
    flex: 1 1 9rem;
  }

  .detail-row .note {
    flex-basis: 100%;
  }

  .filters {
    margin-bottom: 0.5rem;
  }

  .select {
    width: auto;
    min-height: 2.5rem;
    border-radius: 999px;
  }

  .list {
    margin: 0;
    padding: 0;
    list-style: none;
  }

  @media (max-width: 520px) {
    .main-row {
      flex-direction: column;
    }
  }
</style>
