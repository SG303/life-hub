<script lang="ts">
  import { api, type Task } from '../lib/api';
  import { dueLabel, isOverdue } from '../lib/format';
  import { askAgent } from '../lib/router.svelte';
  import Icon from './Icon.svelte';

  let {
    task,
    today,
    categories = [],
    compact = false,
    onchange,
  }: { task: Task; today: string; categories?: string[]; compact?: boolean; onchange: () => void } = $props();

  let editing = $state(false);
  let confirmDelete = $state(false);
  let cancelDelete = $state<HTMLButtonElement>();

  // Keep keyboard focus inside the row when the trash button is swapped for the confirmation.
  $effect(() => {
    if (confirmDelete) cancelDelete?.focus();
  });
  let error = $state('');
  let draft = $state({ title: '', note: '', dueDate: '', category: '' });

  const overdue = $derived(!task.done && isOverdue(task.dueDate, today));

  async function run(action: () => Promise<unknown>) {
    error = '';
    try {
      await action();
      onchange();
    } catch (e) {
      error = (e as Error).message;
    }
  }

  function startEdit() {
    draft = { title: task.title, note: task.note ?? '', dueDate: task.dueDate ?? '', category: task.category ?? '' };
    editing = true;
  }

  async function save(event: SubmitEvent) {
    event.preventDefault();
    await run(async () => {
      await api.updateTask(task.id, {
        title: draft.title,
        note: draft.note || null,
        dueDate: draft.dueDate || null,
        category: draft.category || null,
      });
      editing = false;
    });
  }
</script>

<li class="task" class:done={task.done} class:overdue class:compact data-testid="task">
  <label class="check">
    <input
      type="checkbox"
      checked={task.done}
      onchange={() => run(() => api.updateTask(task.id, { done: !task.done }))}
    />
    <span class="ring" aria-hidden="true"><Icon name="check" size={17} /></span>
    <span class="visually-hidden">{task.done ? 'Als offen markieren' : 'Als erledigt markieren'}: {task.title}</span>
  </label>

  <div class="body">
    {#if editing}
      <form class="edit" onsubmit={save}>
        <label class="field">Titel<input class="input" bind:value={draft.title} required maxlength="200" /></label>
        <div class="row">
          <label class="field">Fällig<input class="input" type="date" bind:value={draft.dueDate} /></label>
          <label class="field"
            >Liste<input class="input" bind:value={draft.category} maxlength="60" list="task-categories" /></label
          >
        </div>
        <label class="field">Notiz<textarea class="input" bind:value={draft.note} maxlength="4000"></textarea></label>
        <div class="toolbar">
          <button class="button primary" type="submit">Speichern</button>
          <button class="button quiet" type="button" onclick={() => (editing = false)}>Abbrechen</button>
        </div>
        <datalist id="task-categories">
          {#each categories as category (category)}<option value={category}></option>{/each}
        </datalist>
      </form>
    {:else}
      <p class="title">{task.title}</p>
      <p class="meta">
        {#if task.dueDate && !(compact && task.dueDate === today && !task.done)}<span class="due">{dueLabel(task.dueDate, today)}</span>{/if}
        {#if task.category}<span class="category">{task.category}</span>{/if}
      </p>
      {#if task.note && !compact}<p class="note">{task.note}</p>{/if}
    {/if}
    {#if error}<p class="notice error" role="alert">{error}</p>{/if}
  </div>

  {#if !editing}
    <div class="actions">
      {#if confirmDelete}
        <span class="confirm">Aufgabe löschen?</span>
        <button class="button danger" type="button" onclick={() => run(() => api.deleteTask(task.id))}>Löschen</button>
        <button class="button quiet" type="button" bind:this={cancelDelete} onclick={() => (confirmDelete = false)}>Abbrechen</button>
      {:else}
        <button class="button quiet" type="button" onclick={() => askAgent('task', task.id)}>
          <Icon name="agent" size={18} /><span>Agent fragen</span>
        </button>
      {/if}
      {#if !compact && !confirmDelete}
        <button class="button quiet" type="button" onclick={startEdit} aria-label="Bearbeiten: {task.title}">
          <Icon name="edit" size={18} />
        </button>
        <button
          class="button quiet danger"
          type="button"
          onclick={() => (confirmDelete = true)}
          aria-label="Löschen: {task.title}"
        >
          <Icon name="trash" size={18} />
        </button>
      {/if}
    </div>
  {/if}
</li>

<style>
  .task {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 0.25rem 0.85rem;
    padding: 0.75rem 0;
    border-top: 1px solid var(--line);
  }

  .task:first-child {
    border-top: 0;
  }

  .check {
    position: relative;
    display: grid;
    place-items: center;
    width: 2.75rem;
    height: 2.75rem;
    margin: -0.4rem 0 0 -0.45rem;
    cursor: pointer;
  }

  .check input {
    position: absolute;
    inset: 0;
    margin: 0;
    opacity: 0;
    cursor: pointer;
  }

  .ring {
    display: grid;
    place-items: center;
    width: 1.85rem;
    height: 1.85rem;
    border: 2px solid var(--accent);
    border-radius: 50%;
    color: transparent;
    transition: background-color 180ms ease, transform 180ms ease;
  }

  .ring :global(svg) {
    stroke-width: 2.6;
  }

  .check:hover .ring {
    background: var(--accent-wash);
  }

  .check input:focus-visible + .ring {
    outline: 3px solid var(--accent);
    outline-offset: 3px;
  }

  .done .ring {
    background: var(--accent);
    color: var(--accent-on);
    transform: scale(1.04);
  }

  .body {
    min-width: 0;
    align-self: center;
  }

  .title {
    margin: 0;
    font-size: 1.0625rem;
    font-weight: 600;
    line-height: 1.3;
    overflow-wrap: anywhere;
  }

  .done .title {
    color: var(--soft);
    text-decoration: line-through;
    text-decoration-thickness: 1.5px;
  }

  .meta {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.2rem 0.6rem;
    margin: 0.15rem 0 0;
  }

  .meta:empty {
    display: none;
  }

  /* Overdue is the only place ochre appears. */
  .overdue .due {
    padding: 0.05rem 0.55rem;
    border-radius: 999px;
    background: var(--badge);
    color: var(--badge-ink);
    font-weight: 650;
  }

  .note {
    margin: 0.35rem 0 0;
    color: var(--soft);
    white-space: pre-line;
    overflow-wrap: anywhere;
    max-width: 65ch;
  }

  .actions {
    grid-column: 2;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.25rem;
    margin-left: -0.7rem;
  }

  .confirm {
    flex-basis: 100%;
    margin-left: 0.7rem;
    color: var(--soft);
    font-size: var(--step--1);
  }

  .edit {
    display: grid;
    gap: 0.75rem;
    max-width: 40rem;
  }

  .row {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(10rem, 1fr));
    gap: 0.75rem;
  }

  /* Compact (Heute): «Agent fragen» is an icon button beside the title. */
  .compact {
    grid-template-columns: auto 1fr auto;
    align-items: center;
  }

  .compact .actions {
    grid-column: 3;
    grid-row: 1;
    margin: 0 -0.5rem 0 0;
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

  @media (min-width: 640px) {
    .task {
      grid-template-columns: auto 1fr auto;
      align-items: start;
    }

    .actions {
      grid-column: 3;
      grid-row: 1;
      margin: -0.2rem -0.5rem 0 0;
    }

    .compact {
      align-items: center;
    }

    .compact .actions {
      margin-top: 0;
    }
  }
</style>
