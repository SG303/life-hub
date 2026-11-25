<script lang="ts">
  import { untrack } from 'svelte';
  import { api, type Task } from '../lib/api';
  import Icon from './Icon.svelte';
  import Sheet from './Sheet.svelte';

  export interface TaskDraft {
    title?: string;
    dueDate?: string;
    category?: string;
    note?: string;
  }

  let {
    open = $bindable(false),
    categories = [],
    initial,
    keepCategory = false,
    oncreated,
  }: {
    open?: boolean;
    categories?: string[];
    initial?: TaskDraft;
    keepCategory?: boolean;
    oncreated: (task: Task) => void | Promise<void>;
  } = $props();

  let draft = $state({ title: '', dueDate: '', category: '', note: '' });
  let lastCategory = '';
  let saving = $state(false);
  let createError = $state('');

  $effect(() => {
    if (!open) return;
    const seed = untrack(() => initial);
    const keep = untrack(() => keepCategory);
    createError = '';
    draft = {
      title: seed?.title ?? '',
      dueDate: seed?.dueDate ?? '',
      category: seed?.category ?? (keep ? lastCategory : ''),
      note: seed?.note ?? '',
    };
  });

  async function create(event: SubmitEvent) {
    event.preventDefault();
    saving = true;
    createError = '';
    try {
      const created = await api.createTask({
        title: draft.title,
        dueDate: draft.dueDate || null,
        category: draft.category || null,
        note: draft.note || null,
      });
      lastCategory = draft.category;
      await oncreated(created);
      open = false;
    } catch (e) {
      createError = (e as Error).message;
    } finally {
      saving = false;
    }
  }
</script>

<Sheet bind:open title="Neue Aufgabe">
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
</style>
