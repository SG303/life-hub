<script lang="ts">
  import Icon from '../components/Icon.svelte';
  import Sheet from '../components/Sheet.svelte';
  import SourceForm from '../components/SourceForm.svelte';
  import { api, type BookmarkExpiryDays, type FeedSource, type FeedType } from '../lib/api';
  import { ago, TYPE_LABEL, TYPE_SINGULAR } from '../lib/format';

  const TYPES: FeedType[] = ['news', 'video', 'podcast'];
  const EXPIRY_OPTIONS: { value: BookmarkExpiryDays; label: string }[] = [
    { value: 7, label: '7 Tage' },
    { value: 14, label: '14 Tage' },
    { value: 30, label: '30 Tage' },
    { value: null, label: 'Aus' },
  ];

  let sources = $state<FeedSource[]>([]);
  let loaded = $state(false);
  let adding = $state(false);
  let version = $state('');
  let agent = $state<{ configured: boolean; model: string | null; reachable: boolean | null } | undefined>();
  let bookmarkExpiryDays = $state<BookmarkExpiryDays>(14);
  let savingExpiry = $state(false);
  let expiryMessage = $state('');
  let expiryError = $state('');
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
    api.feedSettings().then((s) => (bookmarkExpiryDays = s.bookmarkExpiryDays), () => undefined);
    api.health().then((h) => (version = h.version), () => undefined);
    api.agentStatus().then((s) => (agent = s), () => undefined);
  });

  async function setBookmarkExpiry(days: BookmarkExpiryDays) {
    if (savingExpiry || days === bookmarkExpiryDays) return;
    savingExpiry = true;
    expiryError = '';
    expiryMessage = '';
    try {
      const updated = await api.updateFeedSettings({ bookmarkExpiryDays: days });
      bookmarkExpiryDays = updated.bookmarkExpiryDays;
      expiryMessage =
        updated.bookmarkExpiryDays === null
          ? 'Ablauf-Frist deaktiviert (gilt für neue Lesezeichen).'
          : `Standard-Frist auf ${updated.bookmarkExpiryDays} Tage gesetzt.`;
    } catch (e) {
      expiryError = (e as Error).message;
    } finally {
      savingExpiry = false;
    }
  }

  async function added(source: FeedSource) {
    adding = false;
    message = `«${source.title}» abonniert: ${source.itemCount} Einträge, davon ${source.unreadCount} ungelesen.`;
    await load();
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
  <h1>Mehr</h1>
</header>

<section class="block" aria-labelledby="h-sources">
  <div class="block-head">
    <h2 id="h-sources">Quellen</h2>
    <div class="toolbar">
      <label class="button small">
        <Icon name="upload" size={16} />OPML importieren
        <input class="visually-hidden" type="file" accept=".opml,.xml,text/xml,application/xml" onchange={importOpml} />
      </label>
      <button class="button primary small" type="button" onclick={() => (adding = true)}><Icon name="plus" size={16} />Neue Quelle</button>
    </div>
  </div>

  <Sheet bind:open={adding} title="Neue Quelle">
    <SourceForm onadded={added} />
  </Sheet>

  <p class="status" role="status">{message}</p>
  {#if error}<p class="notice error" role="alert">{error}</p>{/if}

  {#each TYPES as type (type)}
    {@const group = sources.filter((s) => s.type === type)}
    {#if group.length}
      <section class="group" aria-labelledby="h-{type}">
        <h3 id="h-{type}">{TYPE_LABEL[type]} <span class="meta">{group.length}</span></h3>
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
    <p class="empty">Noch keine Quellen. Mit «Neue Quelle» eine Feed-Adresse oder einen YouTube-Kanal abonnieren, oder eine OPML-Datei importieren.</p>
  {/if}
</section>

<section class="block" aria-labelledby="h-bookmarks">
  <h2 id="h-bookmarks">Lesezeichen</h2>
  <div class="sheet settings">
    <div class="setting-row">
      <div class="setting-copy">
        <p class="title">Ablauf-Frist</p>
        <p class="meta">Gemerkte Einträge fragen nach dieser Frist freundlich nach. Änderungen gelten für neue und verlängerte Lesezeichen.</p>
      </div>
      <div class="segments" role="group" aria-label="Ablauf-Frist">
        {#each EXPIRY_OPTIONS as option (option.label)}
          <button
            type="button"
            disabled={savingExpiry}
            aria-pressed={bookmarkExpiryDays === option.value}
            onclick={() => setBookmarkExpiry(option.value)}
          >
            {option.label}
          </button>
        {/each}
      </div>
    </div>
    {#if expiryMessage}<p class="setting-status" role="status">{expiryMessage}</p>{/if}
    {#if expiryError}<p class="notice error" role="alert">{expiryError}</p>{/if}
  </div>
</section>

<section class="block" aria-labelledby="h-info">
  <h2 id="h-info">Info</h2>
  <dl class="sheet info">
    <div><dt>Version</dt><dd>{version || '–'}</dd></div>
    <div>
      <dt>Agent</dt>
      <dd>
        {#if !agent}–{:else if !agent.configured}Nicht konfiguriert{:else}{agent.model}, {agent.reachable ? 'erreichbar' : 'nicht erreichbar'}{/if}
      </dd>
    </div>
  </dl>
</section>

<style>
  .block + .block {
    margin-top: 2.5rem;
  }

  .block-head {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem 1rem;
  }

  .status {
    min-height: 1.5rem;
    margin: 0.75rem 0;
    color: var(--soft);
  }

  .group {
    margin-top: 1.25rem;
  }

  h3 {
    margin-bottom: 0.6rem;
  }

  #h-bookmarks,
  #h-info {
    margin-bottom: 0.75rem;
  }

  .settings {
    padding-block: 0.9rem;
  }

  .setting-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem 1.25rem;
  }

  .setting-copy {
    flex: 1 1 16rem;
    min-width: 0;
  }

  .setting-copy .meta {
    margin: 0.15rem 0 0;
  }

  .settings .segments {
    background: var(--bg);
  }

  .setting-status {
    margin: 0.65rem 0 0;
    color: var(--soft);
    font-size: var(--step--1);
  }

  .info {
    padding-block: 0.25rem;
  }

  .info div {
    display: flex;
    justify-content: space-between;
    gap: 1rem;
    padding: 0.8rem 0;
    border-top: 1px solid var(--line);
  }

  .info div:first-child {
    border-top: 0;
  }

  .info dt {
    color: var(--soft);
  }

  .info dd {
    margin: 0;
    text-align: right;
    overflow-wrap: anywhere;
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
