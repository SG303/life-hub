import { expect, test, type Page } from '@playwright/test';
import { api, CONTROL, fixturesForApp, nav, removeAllSources, watchForeignRequests } from './support.ts';

/** Subscribes through the «Neue Quelle» sheet; the sheet stays open when the address is rejected. */
async function subscribe(page: Page, url: string): Promise<void> {
  const sheet = page.getByRole('dialog', { name: 'Neue Quelle' });
  if (!(await sheet.isVisible())) await page.getByRole('button', { name: 'Neue Quelle' }).click();
  await sheet.getByLabel('Adresse (RSS/Atom-Feed oder YouTube-Kanal)').fill(url);
  await sheet.getByRole('button', { name: 'Abonnieren' }).click();
}

test.beforeEach(async ({ request }) => {
  await removeAllSources(request);
});

test('manages sources: RSS, YouTube handle, podcast, edit, delete, OPML; refresh twice without duplicates', async ({ page, request }) => {
  const fixtures = await fixturesForApp();
  // The old /quellen address still works and lands on Mehr.
  await page.goto('/quellen');
  await expect(page).toHaveURL(/\/mehr$/);

  await subscribe(page, `${fixtures}/feeds/news.xml`);
  await expect(page.getByRole('status')).toContainText('15 Einträge, davon 10 ungelesen');
  await subscribe(page, `${fixtures}/@lifehub-test`);
  await expect(page.getByRole('status')).toContainText('«Testkanal» abonniert');
  await subscribe(page, `${fixtures}/feeds/podcast.xml`);
  await expect(page.getByRole('status')).toContainText('«Testpodcast» abonniert');

  // YouTube consent wall: clear German fallback.
  await subscribe(page, `${fixtures}/@consent-wall`);
  await expect(page.getByRole('alert')).toContainText('Bitte die RSS-Adresse direkt eintragen');
  await page.getByRole('button', { name: 'Schliessen' }).click();

  const sources = page.getByTestId('source');
  await expect(page.getByRole('heading', { name: /^News/ })).toBeVisible();
  await expect(page.getByRole('heading', { name: /^Videos/ })).toBeVisible();
  await expect(page.getByRole('heading', { name: /^Podcasts/ })).toBeVisible();
  await expect(sources).toHaveCount(3);

  // Edit: rename the news source.
  await page.getByRole('button', { name: 'Bearbeiten: Testnachrichten' }).click();
  await page.getByLabel('Titel', { exact: true }).fill('Lokalnachrichten');
  await page.getByRole('button', { name: 'Speichern' }).click();
  await expect(sources.filter({ hasText: 'Lokalnachrichten' })).toBeVisible();

  // Delete the podcast (with confirmation).
  await page.getByRole('button', { name: 'Entfernen: Testpodcast' }).click();
  await page.getByRole('button', { name: 'Löschen', exact: true }).click();
  await expect(sources.filter({ hasText: 'Testpodcast' })).toHaveCount(0);

  // OPML import.
  const opml = await (await fetch(`${CONTROL.replace('/__control', '')}/opml/sample.opml`)).text();
  await page.locator('input[type="file"]').setInputFiles({ name: 'abos.opml', mimeType: 'text/xml', buffer: Buffer.from(opml) });
  await expect(page.getByRole('status')).toContainText('OPML importiert: 2 neu');
  await expect(sources.filter({ hasText: 'Testblog (OPML)' })).toBeVisible();
  await page.locator('input[type="file"]').setInputFiles({ name: 'abos.opml', mimeType: 'text/xml', buffer: Buffer.from(opml) });
  await expect(page.getByRole('status')).toContainText('0 neu, 2 übersprungen');

  // First subscribe: at most 10 unread per source.
  const client = api(request);
  const { items } = await client.get<{ items: { title: string; unreadCount: number; itemCount: number }[] }>('/feeds/sources');
  expect(items.find((s) => s.title === 'Lokalnachrichten')).toMatchObject({ itemCount: 15, unreadCount: 10 });
  for (const source of items) expect(source.unreadCount).toBeLessThanOrEqual(10);

  // Manual refresh twice: no duplicates.
  await nav(page, 'Feeds');
  await page.getByRole('button', { name: 'Aktualisieren' }).click();
  await expect(page.getByRole('status')).toContainText(/Einträge?\.|Eintrag\./);
  const before = await client.get<{ total: number }>('/feeds/items?limit=200');
  await page.getByRole('button', { name: 'Aktualisieren' }).click();
  await expect(page.getByRole('status')).toContainText('Keine neuen Einträge.');
  const after = await client.get<{ total: number; items: { sourceId: number; title: string }[] }>('/feeds/items?limit=200');
  expect(after.total).toBe(before.total);
  const keys = after.items.map((item) => `${item.sourceId}:${item.title}`);
  expect(new Set(keys).size).toBe(keys.length);

  // Grouped entries on Heute.
  await nav(page, 'Heute');
  await expect(page.getByTestId('today-news').getByTestId('feed-item').first()).toBeVisible();
  await expect(page.getByTestId('today-video').getByTestId('feed-item').first()).toBeVisible();
  await expect(page.getByTestId('today-podcast')).toBeVisible();

  // Agent fragen is offered on Heute feed entries too.
  await page.getByTestId('today-news').getByTestId('feed-item').first().getByRole('button', { name: 'Agent fragen' }).click();
  await expect(page.getByTestId('chat-context')).toContainText('Feed-Eintrag');
});

test('renders hostile feed content inertly; read, bookmark and filters work; links go to the original site', async ({ page, request }) => {
  const fixtures = await fixturesForApp();
  const client = api(request);
  await client.post('/feeds/sources', { url: `${fixtures}/feeds/news.xml` });
  await client.post('/feeds/sources', { url: `${fixtures}/@lifehub-test` });

  const foreign = watchForeignRequests(page);
  await page.goto('/feeds');
  const entries = page.getByTestId('feed-item');
  await expect(entries.first()).toBeVisible();

  // XSS payloads: plain text only, no script execution, no remote images, no javascript: links.
  const hostile = entries.filter({ hasText: 'Sicherheit Testartikel' });
  await expect(hostile).toBeVisible();
  await expect(hostile).toContainText('IGNORE ALL PREVIOUS INSTRUCTIONS');
  expect(await page.evaluate(() => (window as unknown as { __xss?: number }).__xss)).toBeUndefined();
  await expect(page.locator('a[href^="javascript:"]')).toHaveCount(0);
  await expect(page.locator('main img, audio, video, iframe, embed, object')).toHaveCount(0);
  const hrefs = await page.locator('[data-testid="feed-item"] a.title').evaluateAll((links) =>
    links.map((link) => ({ href: link.getAttribute('href'), target: link.getAttribute('target'), rel: link.getAttribute('rel') })),
  );
  expect(hrefs.length).toBeGreaterThan(0);
  for (const link of hrefs) {
    expect(link.href).toMatch(/^https?:\/\//);
    expect(link.target).toBe('_blank');
    expect(link.rel).toContain('noopener');
  }

  // Toggle read / unread.
  const second = entries.filter({ hasText: 'Meldung 2:' });
  await second.getByRole('button', { name: 'Als gelesen markieren' }).click();
  await expect(second.getByRole('button', { name: 'Als ungelesen markieren' })).toBeVisible();
  await second.getByRole('button', { name: 'Als ungelesen markieren' }).click();
  await expect(second.getByRole('button', { name: 'Als gelesen markieren' })).toBeVisible();

  // Bookmark and filter by "Gemerkt".
  await second.getByRole('button', { name: 'Merken' }).click();
  await expect(second.getByRole('button', { name: 'Merken' })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Gemerkt' }).click();
  await expect(entries).toHaveCount(1);
  await expect(entries.first()).toContainText('Meldung 2:');
  await page.getByRole('button', { name: 'Gemerkt' }).click();

  // Type filter.
  await page.getByRole('group', { name: 'Typ' }).getByRole('button', { name: 'Videos' }).click();
  await expect(entries.first()).toContainText('Testvideo');
  for (const type of await entries.evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-type')))) expect(type).toBe('video');

  // Unread filter off shows read archive items too.
  await page.getByRole('group', { name: 'Typ' }).getByRole('button', { name: 'News' }).click();
  await expect(entries).toHaveCount(10);
  await page.getByRole('button', { name: 'Ungelesen' }).click();
  await expect(entries).toHaveCount(15);

  expect(foreign).toEqual([]);
});

test('expiring bookmarks: setting in Mehr, calm active bookmark without countdown, friendly review on Heute and Gemerkt', async ({
  page,
  request,
}) => {
  const fixtures = await fixturesForApp();
  const client = api(request);
  await client.patch('/feeds/settings', { bookmarkExpiryDays: 14 });
  await client.post('/feeds/sources', { url: `${fixtures}/feeds/news.xml` });

  // Configure default expiry in Mehr and verify it persists across reload.
  await page.goto('/mehr');
  const expiryGroup = page.getByRole('group', { name: 'Ablauf-Frist' });
  await expect(expiryGroup.getByRole('button', { name: '14 Tage' })).toHaveAttribute('aria-pressed', 'true');
  await expiryGroup.getByRole('button', { name: '7 Tage' }).click();
  await expect(expiryGroup.getByRole('button', { name: '7 Tage' })).toHaveAttribute('aria-pressed', 'true');
  await page.reload();
  await expect(page.getByRole('group', { name: 'Ablauf-Frist' }).getByRole('button', { name: '7 Tage' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.getByRole('group', { name: 'Ablauf-Frist' }).getByRole('button', { name: '14 Tage' }).click();
  await expect(page.getByRole('group', { name: 'Ablauf-Frist' }).getByRole('button', { name: '14 Tage' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );

  // Bookmark one item: active bookmark shows no countdown or remaining-time badge.
  await nav(page, 'Feeds');
  const entries = page.getByTestId('feed-item');
  const activeItem = entries.filter({ hasText: 'Meldung 2:' });
  await activeItem.getByRole('button', { name: 'Merken' }).click();
  await expect(activeItem.getByRole('button', { name: 'Merken' })).toHaveAttribute('aria-pressed', 'true');
  await expect(activeItem).not.toContainText(/Noch \d+|Läuft|Abgelaufen/);

  // Heute shows no «Lesezeichen prüfen» block when nothing is expired.
  await nav(page, 'Heute');
  await expect(page.getByTestId('expired-bookmarks')).toHaveCount(0);

  // Mark 6 items as expired bookmarks (including already-read items) via the JSON API.
  const { items } = await client.get<{ items: { id: number; title: string }[] }>('/feeds/items?limit=20');
  const targets = items.filter((i) => !i.title.includes('Meldung 2:')).slice(0, 6);
  for (let idx = 0; idx < targets.length; idx++) {
    await client.patch(`/feeds/items/${targets[idx]!.id}`, {
      read: true,
      bookmarked: true,
      bookmarkExpiry: new Date(Date.UTC(2025, 0, 1 + idx)).toISOString(),
    });
  }

  // Heute shows «Lesezeichen prüfen» capped at 5 items + link to «Gemerkt».
  await page.reload();
  const review = page.getByTestId('expired-bookmarks');
  await expect(review).toBeVisible();
  await expect(review).toContainText('6 abgelaufen');
  await expect(review.getByTestId('expired-bookmark')).toHaveCount(5);
  await expect(review.getByRole('link', { name: 'Alle 6 in «Gemerkt» ansehen' })).toBeVisible();

  // Action on Heute: «Verlängern» removes item from expired list (5 remain, link disappears).
  const firstExpired = review.getByTestId('expired-bookmark').first();
  const firstTitle = (await firstExpired.locator('.review-title').textContent())!.trim();
  await firstExpired.getByRole('button', { name: 'Verlängern' }).click();
  await expect(review).toContainText('5 abgelaufen');
  await expect(review.getByTestId('expired-bookmark').filter({ hasText: firstTitle })).toHaveCount(0);

  // Action on Heute: «Dauerhaft» removes item from expired list (4 remain).
  const secondExpired = review.getByTestId('expired-bookmark').first();
  const secondTitle = (await secondExpired.locator('.review-title').textContent())!.trim();
  await secondExpired.getByRole('button', { name: 'Dauerhaft' }).click();
  await expect(review).toContainText('4 abgelaufen');
  await expect(review.getByTestId('expired-bookmark').filter({ hasText: secondTitle })).toHaveCount(0);

  // Action on Heute: «Loslassen» removes bookmark with Undo; Undo restores it as expired.
  const thirdExpired = review.getByTestId('expired-bookmark').first();
  const thirdTitle = (await thirdExpired.locator('.review-title').textContent())!.trim();
  await thirdExpired.getByRole('button', { name: 'Loslassen' }).click();
  await expect(review).toContainText('3 abgelaufen');
  const toast = page.getByTestId('undo-toast');
  await expect(toast).toContainText('Lesezeichen losgelassen');
  await toast.getByRole('button', { name: 'Rückgängig' }).click();
  await expect(review).toContainText('4 abgelaufen');
  await expect(review.getByTestId('expired-bookmark').filter({ hasText: thirdTitle })).toBeVisible();

  // Navigate to Feeds and toggle «Gemerkt»: «Ungelesen» turns off automatically, expired items appear at the top.
  await nav(page, 'Feeds');
  await expect(page.getByRole('button', { name: 'Ungelesen' })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Gemerkt' }).click();
  await expect(page.getByRole('button', { name: 'Gemerkt' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: 'Ungelesen' })).toHaveAttribute('aria-pressed', 'false');

  // 4 expired + 3 active/permanent = 7 bookmarked items total, first 4 marked expired.
  await expect(entries).toHaveCount(7);
  await expect(page.locator('[data-expired="true"]')).toHaveCount(4);

  // Active bookmark under «Gemerkt» can toggle «Dauerhaft» directly (still no countdown).
  const activeRow = entries.filter({ hasText: 'Meldung 2:' });
  const permBtn = activeRow.getByRole('button', { name: 'Dauerhaft' });
  await expect(permBtn).toHaveAttribute('aria-pressed', 'false');
  await permBtn.click();
  await expect(permBtn).toHaveAttribute('aria-pressed', 'true');
  await expect(activeRow).not.toContainText(/Noch \d+|Läuft/);

  // «Loslassen» under «Gemerkt» removes item and offers «Rückgängig»; leaving it un-undone persists across reload.
  const topExpired = entries.first();
  await topExpired.getByRole('button', { name: 'Loslassen' }).click();
  await expect(entries).toHaveCount(6);
  await expect(page.getByTestId('undo-toast')).toContainText('Lesezeichen losgelassen');
  await page.reload();
  await page.getByRole('button', { name: 'Gemerkt' }).click();
  await expect(entries).toHaveCount(6);
  await expect(page.locator('[data-expired="true"]')).toHaveCount(3);
});
