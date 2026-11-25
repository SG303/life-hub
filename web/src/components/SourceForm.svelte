<script lang="ts">
  import { api, type FeedSource, type FeedType } from '../lib/api';
  import { TYPE_SINGULAR } from '../lib/format';
  import Icon from './Icon.svelte';

  /** Subscribes to a new feed or YouTube channel; used inside the «Neue Quelle» sheet. */
  let { onadded }: { onadded: (source: FeedSource) => void } = $props();

  const TYPES: FeedType[] = ['news', 'video', 'podcast'];
  let draft = $state({ url: '', type: '' as FeedType | '', title: '' });
  let adding = $state(false);
  let error = $state('');

  async function add(event: SubmitEvent) {
    event.preventDefault();
    adding = true;
    error = '';
    try {
      const source = await api.addSource({ url: draft.url, type: draft.type || undefined, title: draft.title || undefined });
      draft = { url: '', type: '', title: '' };
      onadded(source);
    } catch (e) {
      error = (e as Error).message;
    } finally {
      adding = false;
    }
  }
</script>

<form class="form" onsubmit={add} aria-label="Quelle hinzufügen">
  <label class="field">
    Adresse (RSS/Atom-Feed oder YouTube-Kanal)
    <!-- svelte-ignore a11y_autofocus -->
    <input
      class="input"
      type="url"
      bind:value={draft.url}
      required
      placeholder="https://www.youtube.com/@kanal oder https://…/feed.xml"
      autocomplete="off"
      autofocus
    />
  </label>
  <div class="row">
    <label class="field">
      Typ
      <select class="input" bind:value={draft.type}>
        <option value="">Automatisch erkennen</option>
        {#each TYPES as t (t)}<option value={t}>{TYPE_SINGULAR[t]}</option>{/each}
      </select>
    </label>
    <label class="field">Titel (optional)<input class="input" bind:value={draft.title} maxlength="200" /></label>
  </div>
  {#if error}<p class="notice error" role="alert">{error}</p>{/if}
  <button class="button primary submit" type="submit" disabled={adding}>
    <Icon name="plus" size={18} />{adding ? 'Wird geprüft …' : 'Abonnieren'}
  </button>
</form>

<style>
  .form {
    display: grid;
    gap: 0.85rem;
  }

  .row {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(10rem, 1fr));
    gap: 0.75rem;
  }

  .notice {
    margin: 0;
  }

  .submit {
    justify-content: center;
  }
</style>
