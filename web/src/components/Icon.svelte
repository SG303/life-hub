<script lang="ts">
  const PATHS: Record<string, string> = {
    today: 'M4 8h16M8 3v4M16 3v4M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Zm4 9 2 2 4-4',
    tasks: 'M9 6h11M9 12h11M9 18h11M4 5.5l1 1 2-2M4 11.5l1 1 2-2M4 17.5l1 1 2-2',
    feeds: 'M5 5a14 14 0 0 1 14 14M5 11a8 8 0 0 1 8 8M6 19a1 1 0 1 0 0-.01',
    chat: 'M5 5h14a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H10l-4 3v-3H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Z',
    sources: 'M12 4c4.4 0 8 3.1 8 7.5S16.4 20 12 20s-8-3.8-8-8.5S7.6 4 12 4Zm0 4c2.2 0 4 1.6 4 3.7s-1.8 4.3-4 4.3-4-2-4-4.3S9.8 8 12 8Z',
    check: 'm5 12.5 4.5 4.5L19 7.5',
    bookmark: 'M7 4h10a1 1 0 0 1 1 1v15l-6-4-6 4V5a1 1 0 0 1 1-1Z',
    refresh: 'M20 11a8 8 0 0 0-14.5-4.5M4 4v3.5h3.5M4 13a8 8 0 0 0 14.5 4.5M20 20v-3.5h-3.5',
    external: 'M14 5h5v5M19 5l-8 8M17 14v4a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1h4',
    trash: 'M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12',
    edit: 'M5 19h4L19 9l-4-4L5 15v4ZM13 7l4 4',
    agent: 'M12 3v3M12 18v3M3 12h3M18 12h3M12 8l1.2 2.8L16 12l-2.8 1.2L12 16l-1.2-2.8L8 12l2.8-1.2L12 8Z',
    plus: 'M12 5v14M5 12h14',
    read: 'M4 12s3-6 8-6 8 6 8 6-3 6-8 6-8-6-8-6Zm8 2.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z',
    upload: 'M12 16V4M7 9l5-5 5 5M5 20h14',
    close: 'M6 6l12 12M18 6 6 18',
  };

  let { name, size = 20, filled = false }: { name: string; size?: number; filled?: boolean } = $props();
</script>

<svg
  width={size}
  height={size}
  viewBox="0 0 24 24"
  fill={filled ? 'currentColor' : 'none'}
  stroke="currentColor"
  stroke-width="1.8"
  stroke-linecap="round"
  stroke-linejoin="round"
  aria-hidden="true"
  focusable="false"><path d={PATHS[name] ?? ''} /></svg>
