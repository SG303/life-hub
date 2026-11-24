const DAY_MS = 24 * 60 * 60 * 1000;

function civilToUtc(date: string): number {
  return Date.parse(`${date}T00:00:00Z`);
}

/** Human due label relative to `today` (both `YYYY-MM-DD`). */
export function dueLabel(dueDate: string, today: string): string {
  const diff = Math.round((civilToUtc(dueDate) - civilToUtc(today)) / DAY_MS);
  if (diff === 0) return 'Heute';
  if (diff === 1) return 'Morgen';
  if (diff === -1) return 'Gestern';
  if (diff < 0) return `Seit ${-diff} Tagen`;
  if (diff < 7) {
    return new Intl.DateTimeFormat('de-CH', { weekday: 'long', timeZone: 'UTC' }).format(civilToUtc(dueDate));
  }
  return new Intl.DateTimeFormat('de-CH', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(civilToUtc(dueDate));
}

export function isOverdue(dueDate: string | null, today: string): boolean {
  return dueDate !== null && dueDate < today;
}

/** "vor 5 Min.", "vor 3 Std.", "vor 2 Tagen", else a short date. */
export function ago(iso: string | null, now: number = Date.now()): string {
  if (!iso) return '';
  const diff = now - Date.parse(iso);
  if (diff < 60_000) return 'gerade eben';
  if (diff < 60 * 60_000) return `vor ${Math.floor(diff / 60_000)} Min.`;
  if (diff < DAY_MS) return `vor ${Math.floor(diff / (60 * 60_000))} Std.`;
  if (diff < 7 * DAY_MS) {
    const days = Math.floor(diff / DAY_MS);
    return days === 1 ? 'gestern' : `vor ${days} Tagen`;
  }
  return new Intl.DateTimeFormat('de-CH', { day: 'numeric', month: 'short', year: 'numeric' }).format(Date.parse(iso));
}

export function longDate(today: string): { weekday: string; date: string } {
  const time = civilToUtc(today);
  return {
    weekday: new Intl.DateTimeFormat('de-CH', { weekday: 'long', timeZone: 'UTC' }).format(time),
    date: new Intl.DateTimeFormat('de-CH', { day: 'numeric', month: 'long', timeZone: 'UTC' }).format(time),
  };
}

export const TYPE_LABEL = { news: 'News', video: 'Videos', podcast: 'Podcasts' } as const;
export const TYPE_SINGULAR = { news: 'News', video: 'Video', podcast: 'Podcast' } as const;
