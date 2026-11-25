<script lang="ts">
  import Icon from '../components/Icon.svelte';
  import { api, type FeedSource, type FeedType } from '../lib/api';
  import { ago, TYPE_LABEL, TYPE_SINGULAR } from '../lib/format';

  const TYPES: FeedType[] = ['news', 'video', 'podcast'];

  let sources = $state<FeedSource[]>([]);
  let loaded = $state(false);
  let draft = $state({ url: '', type: '' as FeedType | '', title: '' });
  let adding = $state(false);
  let addError = $state('');
  let message = $state('');
  let error = $state('');
  let editingId = $state<number | null>(null);
  let edit = $state({ url: '', type: 'news' as FeedType, title: '' });
  let editError = $state('');
  let confirmDelete = $state<number | null>(null);

  async function load() {
    try {
      sources = (await api.sources()).items;
      error = '';
    } catch (e) {
      error = (e as Error).message;
    } finally {
      loaded = true;
    }
  }

  $effect(() => {
    void load();
  });

  async function add(event: SubmitEvent) {
    event.preventDefault();
    adding = true;
    addError = '';
    message = '';
    try {
      const source = await api.addSource({ url: draft.url, type: draft.type || undefined, title: draft.title || undefined });
      message = `«${source.title}» abonniert: ${source.itemCount} Einträge, davon ${source.unreadCount} ungelesen.`;
      draft = { url: '', type: '', title: '' };
      await load();
    } catch (e) {
      addError = (e as Error).message;
    } finally {
      adding = false;
    }
  }

  async function importOpml(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    message = '';
    error = '';
    if (file.size > 1024 * 1024) {
      error = 'Die OPML-Datei ist grösser als 1 MB.';
      return;
    }
    try {
      const result = await api.importOpml(await file.text());
      message = `OPML importiert: ${result.added} neu, ${result.skipped} übersprungen (schon vorhanden)${
        result.invalid ? `, ${result.invalid} ungültig` : ''
      }. Neue Quellen werden im Hintergrund abgerufen.`;
      await load();
      setTimeout(() => void load(), 3000);
    } catch (e) {
      error = (e as Error).message;
    }
  }

  function startEdit(source: FeedSource) {
    editingId = source.id;
    edit = { url: source.url, type: source.type, title: source.title };
    editError = '';
  }

  async function save(event: SubmitEvent, source: FeedSource) {
    event.preventDefault();
    editError = '';
    try {
      await api.updateSource(source.id, {
        title: edit.title,
        type: edit.type,
        url: edit.url === source.url ? undefined : edit.url,
      });
      editingId = null;
      await load();
    } catch (e) {
      editError = (e as Error).message;
    }
  }

  async function remove(source: FeedSource) {
    try {
      await api.deleteSource(source.id);
      confirmDelete = null;
      message = `«${source.title}» entfernt.`;
      await load();
    } catch (e) {
      error = (e as Error).message;
    }
  }
</script>

<header class="page-head">
  <h1>Quellen</h1>
  <label class="button">
    <Icon name="upload" size={18} />OPML importieren
    <input class="visually-hidden" type="file" accept=".opml,.xml,text/xml,application/xml" onchange={importOpml} />
  </label>
</header>

<form class="add" onsubmit={add} aria-label="Quelle hinzufügen">
  <label class="field url">
    Adresse (RSS/Atom-Feed oder YouTube-Kanal)
    <input
      class="input"
      type="url"
      bind:value={draft.url}
      required
      placeholder="https://www.youtube.com/@kanal oder https://…/feed.xml"
      autocomplete="off"
    />
  </label>
  <label class="field">
    Typ
    <select class="input" bind:value={draft.type}>
      <option value="">Automatisch erkennen</option>
      {#each TYPES as t (t)}<option value={t}>{TYPE_SINGULAR[t]}</option>{/each}
    </select>
  </label>
  <label class="field">Titel (optional)<input class="input" bind:value={draft.title} maxlength="200" /></label>
  <button class="button primary" type="submit" disabled={adding}>
    <Icon name="plus" size={18} />{adding ? 'Wird geprüft …' : 'Abonnieren'}
  </button>
  {#if addError}<p class="notice error full" role="alert">{addError}</p>{/if}
</form>

<p class="status" role="status">{message}</p>
{#if error}<p class="notice error" role="alert">{error}</p>{/if}

{#each TYPES as type (type)}
  {@const group = sources.filter((s) => s.type === type)}
  {#if group.length}
    <section aria-labelledby="h-{type}">
      <h2 id="h-{type}">{TYPE_LABEL[type]} <span class="meta">{group.length}</span></h2>
      <ul class="sheet">
        {#each group as source (source.id)}
          <li class="source" data-testid="source">
            {#if editingId === source.id}
              <form class="edit" onsubmit={(e) => save(e, source)}>
                <label class="field">Titel<input class="input" bind:value={edit.title} required maxlength="200" /></label>
                <label class="field">Adresse<input class="input" type="url" bind:value={edit.url} required /></label>
                <label class="field">
                  Typ
                  <select class="input" bind:value={edit.type}>
                    {#each TYPES as t (t)}<option value={t}>{TYPE_SINGULAR[t]}</option>{/each}
                  </select>
                </label>
                <div class="toolbar">
                  <button class="button primary" type="submit">Speichern</button>
                  <button class="button quiet" type="button" onclick={() => (editingId = null)}>Abbrechen</button>
                </div>
                {#if editError}<p class="notice error" role="alert">{editError}</p>{/if}
              </form>
            {:else}
              <div class="body">
                <p class="title">{source.title}</p>
                <p class="meta url">{source.url}</p>
                <p class="meta">
                  {source.itemCount} Einträge, {source.unreadCount} ungelesen.
                  {source.lastFetchedAt ? `Zuletzt abgerufen ${ago(source.lastFetchedAt)}.` : 'Noch nicht abgerufen.'}
                </p>
                {#if source.lastError}<p class="problem">{source.lastError}</p>{/if}
              </div>
              <div class="actions">
                {#if confirmDelete === source.id}
                  <span class="meta">Quelle und ihre Einträge löschen?</span>
                  <button class="button danger" type="button" onclick={() => remove(source)}>Löschen</button>
                  <button class="button quiet" type="button" onclick={() => (confirmDelete = null)}>Abbrechen</button>
                {:else}
                  <button class="button quiet" type="button" onclick={() => startEdit(source)} aria-label="Bearbeiten: {source.title}">
                    <Icon name="edit" size={18} />
                  </button>
                  <button
                    class="button quiet danger"
                    type="button"
                    onclick={() => (confirmDelete = source.id)}
                    aria-label="Entfernen: {source.title}"
                  >
                    <Icon name="trash" size={18} />
                  </button>
                {/if}
              </div>
            {/if}
          </li>
        {/each}
      </ul>
    </section>
  {/if}
{/each}

{#if loaded && sources.length === 0}
  <p class="empty">Noch keine Quellen. Oben eine Feed-Adresse oder einen YouTube-Kanal eintragen, oder eine OPML-Datei importieren.</p>
{/if}

<style>
  .add {
    display: grid;
    grid-template-columns: 1fr;
    gap: 0.75rem;
    align-items: end;
    padding: 1.1rem 1.25rem;
    border-radius: var(--radius-l);
    background: var(--surface);
  }

  .full {
    grid-column: 1 / -1;
    margin: 0;
  }

  @media (min-width: 760px) {
    .add {
      grid-template-columns: 2fr 1fr 1fr auto;
    }
  }

  .status {
    min-height: 1.5rem;
    margin: 0.75rem 0;
    color: var(--soft);
  }

  section {
    margin-top: 1.5rem;
  }

  h2 {
    margin-bottom: 0.6rem;
  }

  .source {
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    gap: 0.5rem 1rem;
    padding: 0.85rem 0;
    border-top: 1px solid var(--line);
  }

  .body {
    flex: 1 1 18rem;
    min-width: 0;
  }

  .title {
    margin: 0;
    font-weight: 650;
  }

  .url {
    margin: 0;
    overflow-wrap: anywhere;
  }

  .body .meta {
    margin: 0.1rem 0 0;
  }

  .problem {
    margin: 0.35rem 0 0;
    padding-left: 0.6rem;
    border-left: 3px solid var(--warn);
    color: var(--warn);
    font-size: var(--step--1);
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.25rem;
  }

  .edit {
    display: grid;
    gap: 0.75rem;
    width: 100%;
    max-width: 40rem;
  }
</style>
