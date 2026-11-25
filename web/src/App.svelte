<script lang="ts">
  import Icon from './components/Icon.svelte';
  import { NAV, router } from './lib/router.svelte';
  import Chat from './views/Chat.svelte';
  import Feeds from './views/Feeds.svelte';
  import More from './views/More.svelte';
  import Tasks from './views/Tasks.svelte';
  import Today from './views/Today.svelte';

  const current = $derived(NAV.find((entry) => entry.path === router.path) ?? NAV[0]);
  /** An open conversation takes the whole phone screen; the dock comes back with «Zurück». */
  const chatOpen = $derived(current.path === '/chat' && ['thread', 'kontext', 'neu'].some((key) => router.params.has(key)));

  $effect(() => {
    document.title = current.path === '/' ? 'Life Hub' : `${current.label} – Life Hub`;
  });

  function navigate(event: MouseEvent, path: string) {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
    event.preventDefault();
    if (longPressed) {
      // The click that ends a long press must not open the list on top of the new chat.
      longPressed = false;
      return;
    }
    router.go(path);
  }

  // Long press on the agent button: a new chat right away. A short tap still opens the list.
  const LONG_PRESS_MS = 500;
  let pressTimer: ReturnType<typeof setTimeout> | undefined;
  let pressStart = { x: 0, y: 0 };
  let longPressed = false;

  function pressDown(event: PointerEvent) {
    if (event.button !== 0) return;
    longPressed = false;
    pressStart = { x: event.clientX, y: event.clientY };
    clearTimeout(pressTimer);
    pressTimer = setTimeout(() => {
      longPressed = true;
      navigator.vibrate?.(15);
      router.go('/chat?neu');
      // Phones open the keyboard only for focus during a user gesture, i.e. when the finger lifts.
      window.addEventListener('pointerup', () => document.getElementById('chat-input')?.focus(), { once: true });
    }, LONG_PRESS_MS);
  }

  function pressMove(event: PointerEvent) {
    // Moving the finger (e.g. scrolling) cancels the long press.
    if (Math.hypot(event.clientX - pressStart.x, event.clientY - pressStart.y) > 10) clearTimeout(pressTimer);
  }

  function pressEnd() {
    clearTimeout(pressTimer);
  }
</script>

<a class="skip" href="#inhalt">Zum Inhalt springen</a>

<main id="inhalt" tabindex="-1">
  {#if current.path === '/'}
    <Today />
  {:else if current.path === '/aufgaben'}
    <Tasks />
  {:else if current.path === '/feeds'}
    <Feeds />
  {:else if current.path === '/chat'}
    <Chat />
  {:else if current.path === '/mehr'}
    <More />
  {/if}
</main>

<!-- Floating dock on every screen size; the agent (Chat) sits in the middle. -->
<nav class="dock" class:chat-open={chatOpen} aria-label="Hauptnavigation">
  {#each NAV as entry (entry.path)}
    <a
      href={entry.path}
      class:agent={entry.path === '/chat'}
      aria-current={entry.path === current.path ? 'page' : undefined}
      onclick={(e) => navigate(e, entry.path)}
      onpointerdown={entry.path === '/chat' ? pressDown : undefined}
      onpointermove={entry.path === '/chat' ? pressMove : undefined}
      onpointerup={entry.path === '/chat' ? pressEnd : undefined}
      onpointercancel={entry.path === '/chat' ? pressEnd : undefined}
      oncontextmenu={entry.path === '/chat' ? (e) => e.preventDefault() : undefined}
    >
      <Icon name={entry.icon} size={entry.path === '/chat' ? 28 : 22} />
      <span class:visually-hidden={entry.path === '/chat'}>{entry.label}</span>
    </a>
  {/each}
</nav>

<style>
  .skip {
    position: absolute;
    left: 1rem;
    top: -3rem;
    z-index: 10;
    padding: 0.5rem 1rem;
    background: var(--accent);
    color: var(--accent-on);
    border-radius: var(--radius-s);
  }

  .skip:focus {
    top: 1rem;
  }

  main {
    max-width: 82rem;
    margin: 0 auto;
    padding: 1rem 1rem calc(var(--dock-space) + env(safe-area-inset-bottom, 0px));
    outline: none;
  }

  .dock {
    position: fixed;
    left: 50%;
    bottom: calc(0.85rem + env(safe-area-inset-bottom, 0px));
    z-index: 5;
    display: flex;
    align-items: center;
    gap: 0.15rem;
    padding: 0.35rem;
    border: 1px solid var(--line);
    border-radius: 999px;
    background: var(--dock);
    box-shadow: var(--shadow);
    transform: translateX(-50%);
    backdrop-filter: blur(12px);
  }

  .dock a {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0.1rem;
    width: 4.1rem;
    height: 3.4rem;
    border-radius: 999px;
    color: var(--soft);
    font-size: 0.75rem;
    font-weight: 600;
    text-decoration: none;
  }

  .dock a:hover {
    color: var(--ink);
  }

  .dock a[aria-current='page'] {
    color: var(--accent);
    background: var(--accent-wash);
  }

  .dock a.agent {
    /* No system link menu or text selection on long press. */
    -webkit-touch-callout: none;
    user-select: none;
    touch-action: manipulation;
    width: 3.6rem;
    height: 3.6rem;
    margin: 0 0.2rem;
    border-radius: 50%;
    background: var(--accent);
    color: var(--accent-on);
  }

  .dock a.agent:hover {
    filter: brightness(1.08);
  }

  .dock a.agent[aria-current='page'] {
    box-shadow: 0 0 0 3px var(--accent-wash);
  }

  @media (max-width: 899px) {
    .dock.chat-open {
      display: none;
    }
  }

  @media (min-width: 1000px) {
    main {
      padding-inline: 2.5rem;
      padding-top: 1.75rem;
    }
  }
</style>
