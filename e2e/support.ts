import { expect, type APIRequestContext, type Page } from '@playwright/test';

export const BASE = 'https://127.0.0.1:4643';
export const CONTROL = 'http://127.0.0.1:4610/__control';

/** Base URL of the fixture server as Life Hub sees it (differs in Docker mode). */
export async function fixturesForApp(): Promise<string> {
  const info = (await (await fetch(`${CONTROL}/info`)).json()) as { fixturesForApp: string };
  return info.fixturesForApp;
}

export async function control(path: string): Promise<unknown> {
  const res = await fetch(`${CONTROL}${path}`, { method: path.endsWith('turns') ? 'GET' : 'POST' });
  if (!res.ok) throw new Error(`control ${path}: ${res.status}`);
  return res.json();
}

/** Same-origin JSON API calls (the API rejects writes without a matching Origin). */
export function api(request: APIRequestContext) {
  const headers = { Origin: BASE, 'Content-Type': 'application/json' };
  return {
    get: async <T>(path: string) => (await (await request.get(`/api/v1${path}`)).json()) as T,
    post: async <T>(path: string, data: unknown) => {
      const res = await request.post(`/api/v1${path}`, { headers, data });
      expect(res.ok(), `${path}: ${await res.text()}`).toBeTruthy();
      return (await res.json()) as T;
    },
    delete: async (path: string) => {
      const res = await request.delete(`/api/v1${path}`, { headers: { Origin: BASE } });
      expect(res.ok()).toBeTruthy();
    },
  };
}

export async function removeAllSources(request: APIRequestContext): Promise<void> {
  const client = api(request);
  const { items } = await client.get<{ items: { id: number }[] }>('/feeds/sources');
  for (const source of items) await client.delete(`/feeds/sources/${source.id}`);
}

/** Records every request that leaves the app's origin (e.g. remote images). */
export function watchForeignRequests(page: Page): string[] {
  const foreign: string[] = [];
  page.on('request', (request) => {
    const url = request.url();
    if (!url.startsWith(BASE) && !url.startsWith('data:')) foreign.push(url);
  });
  return foreign;
}

/** Navigates via the main navigation (the floating dock). */
export async function nav(page: Page, label: 'Heute' | 'Aufgaben' | 'Feeds' | 'Chat' | 'Mehr'): Promise<void> {
  await page.getByRole('navigation', { name: 'Hauptnavigation' }).getByRole('link', { name: label, exact: true }).click();
  await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
}

/** Opens the «Neue Aufgabe» sheet on Aufgaben, fills it and saves. */
export async function addTask(page: Page, task: { title: string; dueDate?: string; category?: string }): Promise<void> {
  await page.getByRole('button', { name: 'Neue Aufgabe' }).click();
  const sheet = page.getByRole('dialog', { name: 'Neue Aufgabe' });
  await sheet.getByLabel('Titel').fill(task.title);
  if (task.dueDate !== undefined) await sheet.getByLabel('Fällig').fill(task.dueDate);
  if (task.category !== undefined) await sheet.getByLabel('Liste').fill(task.category);
  await sheet.getByRole('button', { name: 'Hinzufügen' }).click();
  await expect(sheet).toBeHidden();
}

export function civilToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Zurich' }).format(new Date());
}
