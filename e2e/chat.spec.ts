import { expect, test, type Page } from '@playwright/test';
import { api, control, fixturesForApp, nav, removeAllSources, watchForeignRequests } from './support.ts';

interface Turn {
  authorization: string;
  model: string;
  messages: { role: string; content: string }[];
  mcp: { tools: string[]; openTasks: string[]; feedItems: string[] } | { error: string };
}

async function turns(): Promise<Turn[]> {
  return (await control('/agent/turns')) as Turn[];
}

async function send(page: Page, text: string): Promise<void> {
  await page.getByLabel('Nachricht').fill(text);
  await page.getByRole('button', { name: 'Senden' }).click();
}

test.afterEach(async () => {
  await control('/agent/start');
});

test('Agent fragen on a task and a feed item; the agent reads live data over MCP; replies are sanitized and persist', async ({
  page,
  request,
}, info) => {
  const tag = `${info.project.name}-${Date.now()}`;
  const client = api(request);
  await client.post('/tasks', { title: `Ferien planen ${tag}`, note: 'Zug oder Auto?' });
  await removeAllSources(request);
  await client.post('/feeds/sources', { url: `${await fixturesForApp()}/feeds/news.xml` });
  const foreign = watchForeignRequests(page);

  // Agent fragen on a task.
  await page.goto('/aufgaben');
  await page.getByTestId('task').filter({ hasText: `Ferien planen ${tag}` }).getByRole('button', { name: 'Agent fragen' }).click();
  await expect(page).toHaveURL(/\/chat\?kontext=task:\d+/);
  const context = page.getByTestId('chat-context');
  await expect(context).toContainText(`Titel: Ferien planen ${tag}`);
  await expect(context).toContainText('Notiz: Zug oder Auto?');
  await send(page, 'Was soll ich zuerst erledigen?');

  const reply = page.getByTestId('message-assistant').last();
  await expect(reply).toContainText('Antwort vom Test-Agenten');
  await expect(reply).toContainText(`Ferien planen ${tag}`); // read live via MCP

  const turn = (await turns()).at(-1)!;
  expect(turn.authorization).toBe('Bearer e2e-agent-key');
  expect(turn.model).toBe('mock-hermes');
  expect(turn.messages.every((message) => message.role !== 'system')).toBe(true);
  const userMessage = turn.messages.at(-1)!;
  expect(userMessage.role).toBe('user');
  expect(userMessage.content).toMatch(/^Was soll ich zuerst erledigen\?\n\n---\n\[Kontext: Aufgabe #\d+\]/);
  expect('error' in turn.mcp ? turn.mcp.error : turn.mcp.tools.sort()).toEqual([
    'get_feed_item',
    'get_task',
    'list_feed_items',
    'list_tasks',
    'search',
  ]);

  // Sanitized rendering: no script, no images, no javascript: links, safe external link.
  await expect(reply.locator('script, img')).toHaveCount(0);
  await expect(reply.locator('a[href^="javascript:"]')).toHaveCount(0);
  await expect(reply.locator('a[href="https://example.com/info"]')).toHaveAttribute('rel', /noopener/);
  expect(await page.evaluate(() => (window as unknown as { __xss?: number }).__xss)).toBeUndefined();

  // Persists across reload.
  await page.reload();
  await expect(page.getByTestId('message-assistant').last()).toContainText('Antwort vom Test-Agenten');
  await expect(page.getByTestId('message-user').first()).toContainText('Was soll ich zuerst erledigen?');

  // Agent fragen on a feed item: quoted, marked as untrusted.
  await nav(page, 'Feeds');
  await page.getByTestId('feed-item').filter({ hasText: 'Sicherheit Testartikel' }).getByRole('button', { name: 'Agent fragen' }).click();
  await expect(page.getByTestId('chat-context')).toContainText('nicht vertrauenswürdige Daten');
  await send(page, 'Ist das seriös?');
  await expect(page.getByTestId('message-assistant').last()).toContainText('Deine Nachricht beginnt mit: «Ist das seriös?');
  const feedTurn = (await turns()).at(-1)!;
  expect(feedTurn.messages.at(-1)!.content).toContain('<<<ZITAT');

  // Start a new chat.
  await page.getByRole('link', { name: 'Neuer Chat' }).click();
  await expect(page.getByTestId('message-assistant')).toHaveCount(0);
  await send(page, 'Hallo im neuen Chat');
  await expect(page.getByTestId('message-assistant')).toHaveCount(1);

  expect(foreign).toEqual([]);
});

test('a reply that arrives after switching chats stays in its own chat', async ({ page, request }, info) => {
  const tag = `${info.project.name}-${Date.now()}`;
  const client = api(request);
  const other = await client.post<{ id: number }>('/chat/threads', {});
  await client.post(`/chat/threads/${other.id}/messages`, { content: `Thema B ${tag}` });

  // Hold the reply to the next message until the user has switched to the other chat.
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  let replied!: () => void;
  const delivered = new Promise<void>((resolve) => (replied = resolve));
  await page.route('**/api/v1/chat/threads/*/messages', async (route) => {
    const response = await route.fetch();
    await gate;
    await route.fulfill({ response });
    replied();
  });

  await page.goto('/chat');
  await send(page, `Frage A ${tag}`);
  await expect(page.getByTestId('message-user')).toContainText(`Frage A ${tag}`);
  const history = page.locator('details.history');
  if ((await history.getAttribute('open')) === null) await history.locator('summary').click();
  await page.locator(`a[href="/chat?thread=${other.id}"]`).click();
  await expect(page.getByTestId('message-user').first()).toContainText(`Thema B ${tag}`);

  release();
  await delivered;
  await expect(page).toHaveURL(new RegExp(`thread=${other.id}$`));
  await expect(page.getByTestId('message-user')).toHaveCount(1);
  await expect(page.getByTestId('message-user').first()).toContainText(`Thema B ${tag}`);
  await expect(page.getByLabel('Nachricht')).toBeEnabled();
});

test('shows a German error with retry when the agent is down, while other views keep working', async ({ page }, info) => {
  const tag = `${info.project.name}-${Date.now()}`;
  await control('/agent/stop');
  await page.goto('/chat');
  await send(page, `Bist du da? ${tag}`);
  const error = page.getByTestId('message-error');
  await expect(error).toContainText('Der Agent ist nicht erreichbar.');
  await expect(error.getByRole('button', { name: 'Erneut versuchen' })).toBeVisible();

  // Everything else still works.
  await nav(page, 'Heute');
  await expect(page.getByRole('heading', { name: 'Aufgaben', level: 2 })).toBeVisible();
  await nav(page, 'Aufgaben');
  await page.getByPlaceholder('Neue Aufgabe').fill(`Trotz Agent-Ausfall ${tag}`);
  await page.getByRole('button', { name: 'Hinzufügen', exact: true }).click();
  await expect(page.getByTestId('task').filter({ hasText: `Trotz Agent-Ausfall ${tag}` })).toBeVisible();
  await nav(page, 'Feeds');
  await expect(page.getByRole('button', { name: 'Aktualisieren' })).toBeEnabled();
  await nav(page, 'Quellen');
  await expect(page.getByRole('button', { name: 'Abonnieren' })).toBeVisible();

  // Agent back: retry succeeds.
  await control('/agent/start');
  await nav(page, 'Chat');
  const history = page.locator('details.history');
  if ((await history.getAttribute('open')) === null) await history.locator('summary').click();
  await page.getByRole('link', { name: new RegExp(`Bist du da\\? ${tag}`) }).click();
  await page.getByRole('button', { name: 'Erneut versuchen' }).click();
  await expect(page.getByTestId('message-assistant')).toContainText('Antwort vom Test-Agenten');
  await expect(page.getByTestId('message-error')).toHaveCount(0);
});
