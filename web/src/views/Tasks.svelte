<script lang="ts">
  import Icon from '../components/Icon.svelte';
  import Sheet from '../components/Sheet.svelte';
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
  let creating = $state(false);
  let saving = $state(false);
  let createError = $state('');

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

  function openCreate() {
    createError = '';
    creating = true;
  }

  async function create(event: SubmitEvent) {
    event.preventDefault();
    saving = true;
    createError = '';
    try {
      await api.createTask({
        title: draft.title,
        dueDate: draft.dueDate || null,
        category: draft.category || null,
        note: draft.note || null,
      });
      // The list stays for the next task; everything else starts fresh.
      draft = { title: '', dueDate: '', category: draft.category, note: '' };
      creating = false;
      await load();
    } catch (e) {
      createError = (e as Error).message;
    } finally {
      saving = false;
    }
  }
</script>

<header class="page-head">
  <h1>Aufgaben</h1>
  <button class="button primary" type="button" onclick={openCreate}><Icon name="plus" size={18} />Neue Aufgabe</button>
</header>

<Sheet bind:open={creating} title="Neue Aufgabe">
  <form class="form" onsubmit={create} aria-label="Neue Aufgabe">
    <label class="field">
      Titel
      <!-- svelte-ignore a11y_autofocus -->
      <input class="input" bind:value={draft.title} required maxlength="200" autocomplete="off" name="title" autofocus />
    </label>
    <div class="row">
      <label class="field">Fällig<input class="input" type="date" bind:value={draft.dueDate} name="dueDate" /></label>
      <label class="field">Liste<input class="input" bind:value={draft.category} maxlength="60" list="new-task-categories" name="category" /></label>
    </div>
    <label class="field">Notiz (optional)<textarea class="input" bind:value={draft.note} maxlength="4000" name="note"></textarea></label>
    <datalist id="new-task-categories">
      {#each categories as c (c)}<option value={c}></option>{/each}
    </datalist>
    {#if createError}<p class="notice error" role="alert">{createError}</p>{/if}
    <button class="button primary submit" type="submit" disabled={saving}><Icon name="plus" size={18} />Hinzufügen</button>
  </form>
</Sheet>

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
  <ul class="sheet">
    {#each tasks as task (task.id)}
      <TaskItem {task} {today} {categories} onchange={load} />
    {/each}
  </ul>
{:else if loaded}
  <p class="empty">
    {status === 'done' ? 'Noch nichts erledigt.' : 'Keine offenen Aufgaben. Mit «Neue Aufgabe» eine erfassen.'}
  </p>
{/if}

<style>
  .form {
    display: grid;
    gap: 0.85rem;
  }

  .row {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(9rem, 1fr));
    gap: 0.75rem;
  }

  .form .notice {
    margin: 0;
  }

  .submit {
    justify-content: center;
  }

  .filters {
    margin-bottom: 0.5rem;
  }

  .select {
    width: auto;
    min-height: 2.5rem;
    border-radius: 999px;
  }
</style>
