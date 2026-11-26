import { expect, test } from '@playwright/test';
import { api, fixturesForApp, nav } from './support.ts';

test.afterEach(async ({ request }) => {
  await api(request).patch('/integrations/scio/settings', { enabled: false, url: null });
});

test('connects Scio under Mehr and shows due decks as a shelf in Heute', async ({ page }) => {
  const scio = `${await fixturesForApp()}/scio`;
  await page.goto('/');
  await expect(page.getByTestId('scio-shelf')).toHaveCount(0);

  await nav(page, 'Mehr');
  const section = page.getByTestId('app-scio');
  await section.getByLabel('Adresse von Scio').fill(`${scio}/nothing-here`);
  await section.getByRole('button', { name: 'Verbindung prüfen' }).click();
  await expect(section.getByRole('alert')).toContainText('Unter dieser Adresse antwortet kein Scio.');

  await section.getByLabel('Adresse von Scio').fill(`${scio}/`);
  await section.getByRole('button', { name: 'Verbindung prüfen' }).click();
  await expect(section.getByRole('status')).toContainText('4 Decks gefunden');
  await section.getByRole('button', { name: 'Speichern' }).click();
  await expect(section.getByRole('status')).toContainText('erscheinen in «Heute»');
  await expect(section.getByRole('button', { name: 'An', exact: true })).toHaveAttribute('aria-pressed', 'true');

  await nav(page, 'Heute');
  const shelf = page.getByTestId('scio-shelf');
  await expect(shelf.getByRole('heading', { name: /Lernen/ })).toContainText('23 fällig · 12/20 heute');
  const decks = shelf.getByTestId('scio-deck');
  await expect(decks).toHaveCount(3); // Genetik has nothing due
  await expect(decks.first()).toContainText('Zellbiologie');
  await expect(decks.first()).toHaveAttribute('href', `${scio}/flashcards/11/study`);
  await expect(shelf.getByRole('link', { name: /Alle Decks in Scio/ })).toHaveAttribute('href', `${scio}/flashcards`);

  await nav(page, 'Mehr');
  await page.getByTestId('app-scio').getByRole('button', { name: 'Aus', exact: true }).click();
  await nav(page, 'Heute');
  await expect(page.getByRole('heading', { name: 'Aufgaben' })).toBeVisible();
  await expect(page.getByTestId('scio-shelf')).toHaveCount(0);
});
