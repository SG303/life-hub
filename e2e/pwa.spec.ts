import { expect, test } from '@playwright/test';
import { api, nav } from './support.ts';

test('runs in a secure context with strict headers and a valid PWA manifest', async ({ page, request }) => {
  const response = await page.goto('/');
  expect(await page.evaluate(() => window.isSecureContext)).toBe(true);
  expect(response?.headers()['content-security-policy']).toContain("img-src 'self' data:");

  const manifestHref = await page.locator('link[rel="manifest"]').getAttribute('href');
  const manifestResponse = await request.get(manifestHref!);
  expect(manifestResponse.status()).toBe(200);
  const manifest = (await manifestResponse.json()) as {
    display: string;
    start_url: string;
    icons: { src: string; sizes: string; type: string }[];
  };
  expect(manifest.display).toBe('standalone');
  expect(manifest.start_url).toBe('/');
  for (const size of ['192x192', '512x512']) {
    const icon = manifest.icons.find((entry) => entry.sizes === size && entry.type === 'image/png');
    expect(icon, size).toBeDefined();
    const iconResponse = await request.get(icon!.src);
    expect(iconResponse.status()).toBe(200);
    expect(iconResponse.headers()['content-type']).toBe('image/png');
    const [width, height] = size.split('x').map(Number);
    const png = await iconResponse.body();
    expect(png.readUInt32BE(16)).toBe(width);
    expect(png.readUInt32BE(20)).toBe(height);
  }
});

test('shows German UI chrome without ß in every view', async ({ page, request }) => {
  await api(request).post('/tasks', { title: 'Sprachtest' });
  await page.goto('/');
  for (const label of ['Heute', 'Aufgaben', 'Feeds', 'Chat', 'Mehr'] as const) {
    await nav(page, label);
    await page.waitForLoadState('networkidle');
    const text = await page.locator('body').innerText();
    expect(text, label).not.toContain('ß');
    expect(await page.locator('html').getAttribute('lang')).toBe('de-CH');
  }
  await expect(page.getByRole('heading', { name: 'Mehr', level: 1 })).toBeVisible();
});

test('home-screen shortcuts open a new chat, a new task and the feeds', async ({ page, request }) => {
  const manifest = (await (await request.get('/manifest.webmanifest')).json()) as { shortcuts: { name: string; url: string }[] };
  const url = (name: string) => manifest.shortcuts.find((entry) => entry.name === name)!.url;
  expect(manifest.shortcuts.map((entry) => entry.name)).toEqual(['Neuer Chat', 'Neue Aufgabe', 'Feeds']);

  await page.goto(url('Neuer Chat'));
  await expect(page.locator('#chat-input')).toBeFocused();

  await page.goto(url('Neue Aufgabe'));
  await expect(page.getByRole('form', { name: 'Neue Aufgabe' })).toBeVisible();
  await expect(page.getByLabel('Titel')).toBeFocused();
  // The flag is consumed, so a reload shows the plain list.
  await expect(page).toHaveURL(/\/aufgaben$/);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Aufgaben', level: 1 })).toBeVisible();
  await expect(page.getByRole('form', { name: 'Neue Aufgabe' })).toBeHidden();

  await page.goto(url('Feeds'));
  await expect(page.getByRole('heading', { name: 'Feeds', level: 1 })).toBeVisible();
});
