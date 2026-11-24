<script lang="ts">
  import Icon from './components/Icon.svelte';
  import { NAV, router } from './lib/router.svelte';
  import Chat from './views/Chat.svelte';
  import Feeds from './views/Feeds.svelte';
  import Sources from './views/Sources.svelte';
  import Tasks from './views/Tasks.svelte';
  import Today from './views/Today.svelte';

  const current = $derived(NAV.find((entry) => entry.path === router.path) ?? NAV[0]);

  $effect(() => {
    document.title = current.path === '/' ? 'Life Hub' : `${current.label} – Life Hub`;
  });

  function navigate(event: MouseEvent, path: string) {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
    event.preventDefault();
    router.go(path);
  }
</script>

<a class="skip" href="#inhalt">Zum Inhalt springen</a>

<div class="shell">
  <nav class="rail" aria-label="Hauptnavigation">
    <a class="brand" href="/" onclick={(e) => navigate(e, '/')}>
      <img src="/icons/icon.svg" alt="" width="28" height="28" />
      <span>Life Hub</span>
    </a>
    <ul>
      {#each NAV as entry (entry.path)}
        <li>
          <a
            href={entry.path}
            aria-current={entry.path === current.path ? 'page' : undefined}
            onclick={(e) => navigate(e, entry.path)}
          >
            <Icon name={entry.icon} size={22} />
            <span>{entry.label}</span>
          </a>
        </li>
      {/each}
    </ul>
  </nav>

  <main id="inhalt" tabindex="-1">
    {#if current.path === '/'}
      <Today />
    {:else if current.path === '/aufgaben'}
      <Tasks />
    {:else if current.path === '/feeds'}
      <Feeds />
    {:else if current.path === '/chat'}
      <Chat />
    {:else if current.path === '/quellen'}
      <Sources />
    {/if}
  </main>
</div>

<style>
  .skip {
    position: absolute;
    left: 1rem;
    top: -3rem;
    z-index: 10;
    padding: 0.5rem 1rem;
    background: var(--lake);
    color: var(--lake-ink);
    border-radius: var(--radius-s);
  }

  .skip:focus {
    top: 1rem;
  }

  .shell {
    min-height: 100dvh;
  }

  main {
    padding: 1.25rem 1rem calc(var(--tabbar) + 1.5rem + env(safe-area-inset-bottom, 0px));
    max-width: 72rem;
    margin: 0 auto;
    outline: none;
  }

  .rail {
    position: fixed;
    inset: auto 0 0 0;
    z-index: 5;
    height: calc(var(--tabbar) + env(safe-area-inset-bottom, 0px));
    padding-bottom: env(safe-area-inset-bottom, 0px);
    background: var(--sheet);
    border-top: 1px solid var(--rule);
  }

  .brand {
    display: none;
  }

  ul {
    display: grid;
    grid-template-columns: repeat(5, 1fr);
    height: 100%;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  li a {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0.15rem;
    height: 100%;
    color: var(--ink-soft);
    font-size: 0.75rem;
    font-weight: 600;
    text-decoration: none;
  }

  li a[aria-current='page'] {
    color: var(--lake);
  }

  li a[aria-current='page'] :global(svg) {
    stroke-width: 2.4;
  }

  @media (min-width: 900px) {
    .shell {
      display: grid;
      grid-template-columns: var(--rail) 1fr;
    }

    .rail {
      position: sticky;
      top: 0;
      inset: auto;
      height: 100dvh;
      padding: 1.5rem 0.75rem;
      border-top: 0;
      border-right: 1px solid var(--rule);
    }

    .brand {
      display: flex;
      align-items: center;
      gap: 0.6rem;
      margin: 0 0.5rem 2rem;
      color: var(--ink);
      font-weight: 760;
      font-stretch: 78%;
      font-size: var(--step-1);
      text-decoration: none;
    }

    ul {
      display: flex;
      flex-direction: column;
      gap: 0.25rem;
      height: auto;
    }

    li a {
      flex-direction: row;
      justify-content: flex-start;
      gap: 0.75rem;
      padding: 0.6rem 0.75rem;
      border-radius: var(--radius-s);
      font-size: var(--step-0);
    }

    li a:hover {
      background: var(--lake-wash);
      color: var(--ink);
    }

    li a[aria-current='page'] {
      background: var(--lake-wash);
    }

    main {
      width: 100%;
      padding: 2.5rem 2.5rem 3rem;
    }
  }
</style>
