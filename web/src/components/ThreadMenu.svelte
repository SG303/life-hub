<script lang="ts">
  import { api, type ChatThread, type ThreadPatch } from '../lib/api';
  import { localInputValue, snoozePresets, wakeLabel } from '../lib/snooze';
  import Icon from './Icon.svelte';

  /** Actions for one chat: pin, snooze, settle, auto-settle, rename, delete. Lives inside a Sheet. */
  let {
    thread,
    onchanged,
    ondeleted,
  }: { thread: ChatThread; onchanged: (thread: ChatThread) => void; ondeleted: (thread: ChatThread) => void } = $props();

  let view = $state<'main' | 'snooze' | 'rename' | 'delete'>('main');
  let title = $state('');
  let custom = $state('');
  let busy = $state(false);
  let error = $state('');
  const presets = snoozePresets();

  async function run(action: () => Promise<void>) {
    busy = true;
    error = '';
    try {
      await action();
    } catch (e) {
      error = (e as Error).message;
    } finally {
      busy = false;
    }
  }

  const update = (patch: ThreadPatch) => run(async () => onchanged(await api.updateThread(thread.id, patch)));

  function snoozeCustom(event: SubmitEvent) {
    event.preventDefault();
    const until = new Date(custom);
    if (Number.isNaN(until.getTime())) return;
    void update({ snoozedUntil: until.toISOString() });
  }

  function rename(event: SubmitEvent) {
    event.preventDefault();
    void update({ title });
  }

  function remove() {
    void run(async () => {
      await api.deleteThread(thread.id);
      ondeleted(thread);
    });
  }

  function startRename() {
    title = thread.title;
    view = 'rename';
  }

  function startSnooze() {
    custom = localInputValue(new Date(Date.now() + 24 * 60 * 60 * 1000));
    view = 'snooze';
  }
</script>

{#if view === 'main'}
  <ul class="actions">
    <li>
      <button type="button" disabled={busy} onclick={() => update({ pinned: thread.state !== 'pinned' })}>
        <Icon name="pin" />{thread.state === 'pinned' ? 'Nicht mehr anheften' : 'Anheften'}
      </button>
    </li>
    {#if thread.state === 'snoozed'}
      <li>
        <button type="button" disabled={busy} onclick={() => update({ snoozedUntil: null })}>
          <Icon name="clock" />Aufwecken<span class="hint">schlummert bis {wakeLabel(thread.snoozedUntil!)}</span>
        </button>
      </li>
    {/if}
    <li>
      <button type="button" disabled={busy} onclick={startSnooze}>
        <Icon name="clock" />{thread.state === 'snoozed' ? 'Schlummerzeit ändern …' : 'Schlummern …'}
      </button>
    </li>
    <li>
      {#if thread.state === 'settled'}
        <button type="button" disabled={busy} onclick={() => update({ settled: false })}><Icon name="undo" />Wieder aktivieren</button>
      {:else}
        <button type="button" disabled={busy} onclick={() => update({ settled: true })}><Icon name="check" />Erledigt</button>
      {/if}
    </li>
    <li>
      <button
        type="button"
        role="switch"
        aria-checked={thread.autoSettle}
        disabled={busy}
        onclick={() => update({ autoSettle: !thread.autoSettle })}
      >
        <Icon name="refresh" />Automatisch erledigen
        <span class="hint">{thread.autoSettle ? 'nach 7 Tagen ohne Aktivität' : 'nie'}</span>
        <span class="switch" aria-hidden="true"></span>
      </button>
    </li>
    <li><button type="button" disabled={busy} onclick={startRename}><Icon name="edit" />Umbenennen</button></li>
    <li>
      <button class="danger" type="button" disabled={busy || thread.pending} onclick={() => (view = 'delete')}>
        <Icon name="trash" />Löschen
      </button>
    </li>
  </ul>
{:else if view === 'snooze'}
  <p class="lead">Der Chat verschwindet aus «Aktiv» und kommt zur gewählten Zeit zurück.</p>
  <ul class="actions">
    {#each presets as preset (preset.label)}
      <li>
        <button type="button" disabled={busy} onclick={() => update({ snoozedUntil: preset.until.toISOString() })}>
          <Icon name="clock" />{preset.label}
        </button>
      </li>
    {/each}
  </ul>
  <form class="form" onsubmit={snoozeCustom}>
    <label class="field">Eigene Zeit<input class="input" type="datetime-local" bind:value={custom} required /></label>
    <div class="toolbar">
      <button class="button primary" type="submit" disabled={busy}>Schlummern</button>
      <button class="button quiet" type="button" onclick={() => (view = 'main')}>Zurück</button>
    </div>
  </form>
{:else if view === 'rename'}
  <form class="form" onsubmit={rename}>
    <!-- svelte-ignore a11y_autofocus -->
    <label class="field">Titel<input class="input" bind:value={title} required maxlength="120" autofocus /></label>
    <div class="toolbar">
      <button class="button primary" type="submit" disabled={busy}>Speichern</button>
      <button class="button quiet" type="button" onclick={() => (view = 'main')}>Zurück</button>
    </div>
  </form>
{:else}
  <p class="lead">Chat «{thread.title}» mit allen Nachrichten löschen?</p>
  <div class="toolbar">
    <button class="button danger" type="button" disabled={busy} onclick={remove}>
      <Icon name="trash" size={18} />Löschen
    </button>
    <button class="button quiet" type="button" onclick={() => (view = 'main')}>Abbrechen</button>
  </div>
{/if}

{#if error}<p class="notice error" role="alert">{error}</p>{/if}

<style>
  .actions {
    margin: 0 -0.5rem;
    padding: 0;
    list-style: none;
  }

  .actions button {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0 0.85rem;
    width: 100%;
    min-height: 3rem;
    padding: 0.5rem;
    border: 0;
    border-radius: var(--radius-s);
    background: none;
    color: var(--ink);
    font-weight: 600;
    text-align: left;
    cursor: pointer;
  }

  .actions button:hover:not(:disabled) {
    background: var(--accent-wash);
  }

  .actions button:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }

  .actions button.danger {
    color: var(--warn);
  }

  .hint {
    flex-basis: 100%;
    padding-left: calc(20px + 0.85rem);
    color: var(--soft);
    font-size: var(--step--1);
    font-weight: 450;
  }

  .actions [role='switch'] {
    position: relative;
    padding-right: 3.5rem;
  }

  .switch {
    position: absolute;
    right: 0.5rem;
    top: 50%;
    width: 2.4rem;
    height: 1.4rem;
    border-radius: 999px;
    background: var(--surface-2);
    box-shadow: inset 0 0 0 1px var(--line);
    transform: translateY(-50%);
  }

  .switch::after {
    content: '';
    position: absolute;
    top: 0.2rem;
    left: 0.2rem;
    width: 1rem;
    height: 1rem;
    border-radius: 50%;
    background: var(--soft);
    transition: transform 120ms ease-out;
  }

  [aria-checked='true'] .switch {
    background: var(--accent);
  }

  [aria-checked='true'] .switch::after {
    background: var(--accent-on);
    transform: translateX(1rem);
  }

  .lead {
    margin: 0 0 0.75rem;
    color: var(--soft);
  }

  .form {
    display: grid;
    gap: 0.75rem;
    margin-top: 0.75rem;
  }

  .notice {
    margin: 0.75rem 0 0;
  }
</style>
