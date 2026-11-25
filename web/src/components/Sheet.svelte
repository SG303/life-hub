<script lang="ts">
  import type { Snippet } from 'svelte';
  import Icon from './Icon.svelte';

  /** Modal window: a bottom sheet on phones, a centred card on wide screens. */
  let {
    open = $bindable(false),
    title,
    children,
  }: { open?: boolean; title: string; children: Snippet } = $props();

  let dialog = $state<HTMLDialogElement>();
  let closeButton = $state<HTMLButtonElement>();
  const id = $props.id();

  $effect(() => {
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
      // Without a field to type into, focus the sheet itself rather than ringing the close button.
      if (document.activeElement === closeButton) dialog.focus();
    }
    if (!open && dialog.open) dialog.close();
  });

  function backdrop(event: MouseEvent) {
    // A click on the dialog element itself (not its content) is a click on the backdrop.
    if (event.target === dialog) open = false;
  }
</script>

<dialog bind:this={dialog} tabindex="-1" aria-labelledby={id} onclose={() => (open = false)} onclick={backdrop}>
  <div class="panel">
    <header>
      <h2 {id}>{title}</h2>
      <button bind:this={closeButton} class="button quiet close" type="button" onclick={() => (open = false)} aria-label="Schliessen">
        <Icon name="close" size={20} />
      </button>
    </header>
    {#if open}{@render children()}{/if}
  </div>
</dialog>

<style>
  dialog {
    width: 100%;
    max-width: 100%;
    max-height: calc(100dvh - 2rem);
    margin: auto auto 0;
    padding: 0;
    border: 0;
    border-radius: var(--radius-l) var(--radius-l) 0 0;
    background: var(--surface);
    color: var(--ink);
    box-shadow: var(--shadow);
  }

  dialog:focus {
    outline: none;
  }

  dialog::backdrop {
    background: rgb(20 21 18 / 0.4);
  }

  dialog[open] {
    animation: rise 180ms ease-out;
  }

  .panel {
    padding: 1rem 1.25rem calc(1.25rem + env(safe-area-inset-bottom, 0px));
  }

  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    margin-bottom: 0.75rem;
  }

  .close {
    margin-right: -0.5rem;
  }

  @keyframes rise {
    from {
      transform: translateY(1.5rem);
      opacity: 0;
    }
  }

  @media (min-width: 640px) {
    dialog {
      max-width: 32rem;
      margin: auto;
      border-radius: var(--radius-l);
    }

    .panel {
      padding: 1.25rem 1.5rem 1.5rem;
    }
  }
</style>
