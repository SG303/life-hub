<script lang="ts">
  import Icon from './Icon.svelte';

  let {
    id,
    message,
    duration = 5000,
    onundo,
    ondismiss,
  }: {
    id: number;
    message: string;
    duration?: number;
    onundo: () => void | Promise<void>;
    ondismiss: () => void;
  } = $props();

  let undoing = $state(false);

  $effect(() => {
    void id;
    undoing = false;
    const timer = setTimeout(() => ondismiss(), duration);
    return () => clearTimeout(timer);
  });

  async function handleUndo() {
    if (undoing) return;
    undoing = true;
    try {
      await onundo();
    } finally {
      undoing = false;
      ondismiss();
    }
  }
</script>

<div class="undo-toast" role="status" aria-live="polite" data-testid="undo-toast">
  <span class="label">{message}</span>
  <button class="button primary small" type="button" disabled={undoing} onclick={handleUndo}>
    <Icon name="undo" size={16} />Rückgängig
  </button>
</div>

<style>
  .undo-toast {
    position: fixed;
    left: 50%;
    bottom: calc(5.75rem + env(safe-area-inset-bottom, 0px));
    z-index: 6;
    display: flex;
    align-items: center;
    gap: 0.75rem;
    max-width: calc(100vw - 2rem);
    padding: 0.45rem 0.45rem 0.45rem 1rem;
    border: 1px solid var(--line);
    border-radius: 999px;
    background: var(--surface);
    color: var(--ink);
    box-shadow: var(--shadow);
    transform: translateX(-50%);
    animation: toast-in 160ms ease-out;
  }

  .label {
    font-size: var(--step--1);
    font-weight: 600;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  @keyframes toast-in {
    from {
      opacity: 0;
      transform: translate(-50%, 0.75rem);
    }
  }
</style>
