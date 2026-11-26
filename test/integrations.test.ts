import { describe, expect, it } from 'vitest';
import { openMemoryDatabase } from '../src/core/db.ts';
import type { FetchOptions, Fetcher } from '../src/modules/feeds/index.ts';
import { createIntegrationsModule, ScioService } from '../src/modules/integrations/index.ts';
import { fakeFetcher, type Route } from './helpers.ts';

const BASE = 'http://192.0.2.10:8001';

function deck(id: number, title: string, dueReviews: number, newAvailable: number, subjectId: number | null = null) {
  return { id, title, due_reviews: dueReviews, new_available: newAvailable, subject_id: subjectId };
}

function scioRoutes(decks: unknown[] = [deck(1, 'Zellbiologie', 7, 4, 1), deck(2, 'Statistik', 8, 0), deck(3, 'Leer', 0, 0)]) {
  return {
    [`${BASE}/api/flashcards/streak`]: JSON.stringify({ current_streak: 6, longest_streak: 9, reviews_today: 12, daily_goal: 20, due_today: 19 }),
    [`${BASE}/api/flashcards/decks`]: JSON.stringify(decks),
    [`${BASE}/api/subjects`]: JSON.stringify([{ id: 1, title: 'Biologie' }]),
  } satisfies Record<string, Route>;
}

function setup(routes: Record<string, Route | (() => Route)> = scioRoutes()) {
  const fetcher = fakeFetcher(routes);
  const options: FetchOptions[] = [];
  const recording: Fetcher = (url, opts) => {
    options.push(opts);
    return fetcher(url, opts);
  };
  const scio = new ScioService(openMemoryDatabase(), recording);
  return { scio, fetcher, options };
}

describe('Scio settings', () => {
  it('is off until enabled with an address, and normalises the address', () => {
    const { scio } = setup();
    expect(scio.getSettings()).toEqual({ enabled: false, url: null });
    expect(() => scio.setSettings({ enabled: true })).toThrow('Bitte zuerst die Adresse von Scio eintragen.');
    expect(scio.setSettings({ enabled: true, url: ` ${BASE}/ ` })).toEqual({ enabled: true, url: BASE });
    expect(scio.getSettings()).toEqual({ enabled: true, url: BASE });
    expect(scio.setSettings({ enabled: false })).toEqual({ enabled: false, url: BASE });
  });

  it('rejects anything but a plain http(s) base address', () => {
    const { scio } = setup();
    for (const url of ['ftp://scio.example', 'scio.example', 'http://user:pw@scio.example', `${BASE}/?x=1`]) {
      expect(() => scio.setSettings({ url }), url).toThrow();
    }
  });
});

describe('Scio summary', () => {
  it('returns nothing while disabled and never contacts Scio', async () => {
    const { scio, fetcher } = setup();
    expect(await scio.summary()).toEqual({ enabled: false });
    expect(fetcher.calls).toHaveLength(0);
  });

  it('lists decks with due cards, most due first, with subject names and study links', async () => {
    const { scio, options } = setup();
    scio.setSettings({ enabled: true, url: BASE });
    const summary = await scio.summary(new Date('2026-11-26T08:00:00Z'));
    expect(summary).toMatchObject({ enabled: true, state: 'ok', error: null, updatedAt: '2026-11-26T08:00:00.000Z' });
    if (!summary.enabled) throw new Error('disabled');
    expect(summary.data).toMatchObject({ dueToday: 19, reviewsToday: 12, dailyGoal: 20, currentStreak: 6, deckCount: 3, decksUrl: `${BASE}/flashcards` });
    expect(summary.data?.decks).toEqual([
      { id: 1, title: 'Zellbiologie', subject: 'Biologie', due: 11, dueReviews: 7, newAvailable: 4, studyUrl: `${BASE}/flashcards/1/study` },
      { id: 2, title: 'Statistik', subject: null, due: 8, dueReviews: 8, newAvailable: 0, studyUrl: `${BASE}/flashcards/2/study` },
    ]);
    // Scio lives in the private network: only this configured target may be private.
    expect(options.every((o) => o.allowPrivate)).toBe(true);
  });

  it('shows at most eight decks and drops malformed entries from the untrusted response', async () => {
    const decks: unknown[] = Array.from({ length: 10 }, (_, i) => deck(i + 1, `Deck ${i + 1}`, i + 1, 0));
    decks.push({ id: 'x', title: 'kaputt', due_reviews: 50 }, { id: 99, title: 'x'.repeat(500), due_reviews: -3, new_available: 2 }, null);
    const { scio } = setup(scioRoutes(decks));
    scio.setSettings({ enabled: true, url: BASE });
    const summary = await scio.summary();
    if (!summary.enabled) throw new Error('disabled');
    expect(summary.data?.decks).toHaveLength(8);
    expect(summary.data?.decks[0]?.title).toBe('Deck 10');
    expect(summary.data?.decks.map((d) => d.id)).not.toContain(99); // due 2 is below the top eight
  });

  it('asks Scio at most every five minutes', async () => {
    const { scio, fetcher } = setup();
    scio.setSettings({ enabled: true, url: BASE });
    const t0 = new Date('2026-11-26T08:00:00Z').getTime();
    await scio.summary(new Date(t0));
    await scio.summary(new Date(t0 + 4 * 60_000));
    expect(fetcher.calls.filter((u) => u.endsWith('/decks'))).toHaveLength(1);
    await scio.summary(new Date(t0 + 5 * 60_000));
    expect(fetcher.calls.filter((u) => u.endsWith('/decks'))).toHaveLength(2);
  });

  it('keeps the last good state when Scio goes down and retries after a minute', async () => {
    let up = true;
    const routes = scioRoutes();
    const decksUrl = `${BASE}/api/flashcards/decks`;
    const { scio } = setup({ ...routes, [decksUrl]: () => (up ? routes[decksUrl] : { status: 503 }) });
    scio.setSettings({ enabled: true, url: BASE });
    const t0 = new Date('2026-11-26T07:40:00Z').getTime();
    await scio.summary(new Date(t0));
    up = false;
    const down = await scio.summary(new Date(t0 + 5 * 60_000));
    expect(down).toMatchObject({ enabled: true, state: 'error', error: 'Scio antwortet mit Fehler 503.', updatedAt: '2026-11-26T07:40:00.000Z' });
    if (!down.enabled) throw new Error('disabled');
    expect(down.data?.decks).toHaveLength(2);
    up = true;
    expect(await scio.summary(new Date(t0 + 5 * 60_000 + 30_000))).toMatchObject({ state: 'error' });
    expect(await scio.summary(new Date(t0 + 6 * 60_000))).toMatchObject({ state: 'ok', error: null });
  });

  it('still works without subject names', async () => {
    const routes: Record<string, Route> = scioRoutes();
    delete routes[`${BASE}/api/subjects`];
    const { scio } = setup(routes);
    scio.setSettings({ enabled: true, url: BASE });
    expect(await scio.summary()).toMatchObject({ state: 'ok', data: { decks: [{ subject: null }, { subject: null }] } });
  });
});

describe('Scio API', () => {
  it('checks an address before saving it', async () => {
    const module = createIntegrationsModule(openMemoryDatabase(), fakeFetcher(scioRoutes()));
    const route = module.routes.match('POST', '/scio/check');
    if (!route || route === 'method') throw new Error('route missing');
    const call = (url: string) => route.handler({ method: 'POST', path: '/scio/check', params: {}, query: new URLSearchParams(), body: { url } });
    expect(await call(BASE)).toEqual({ deckCount: 3 });
    await expect(call('http://192.0.2.99')).rejects.toThrow('Unter dieser Adresse antwortet kein Scio.');
    expect(module.scio.getSettings()).toEqual({ enabled: false, url: null });
  });
});
