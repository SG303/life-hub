import { expect, test, type Page } from '@playwright/test';
import { addTask, api, control, fixturesForApp, nav, removeAllSources, watchForeignRequests } from './support.ts';

interface Turn {
  authorization: string;
  model: string;
  messages: { role: string; content: string }[];
  mcp: { tools: string[]; openTasks: string[]; feedItems: string[] } | { error: string };
}

async function turns(): Promise<Turn[]> {
  return (await control('/agent/turns')) as Turn[];
}

/** Phones show one conversation full screen; «Zurück» leads to the list (wide screens show both). */
async function toChatList(page: Page): Promise<void> {
  const back = page.getByRole('link', { name: 'Zurück zur Chat-Liste' });
  if (await back.isVisible()) await back.click();
  await expect(page.getByRole('heading', { name: 'Chat', level: 1 })).toBeVisible();
}

async function send(page: Page, text: string): Promise<void> {
  await page.getByLabel('Nachricht').fill(text);
  await page.getByRole('button', { name: 'Senden' }).click();
}

test.afterEach(async () => {
  await control('/agent/start');
  await control('/agent/mode', { mode: 'sse', hold: false });
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
  await toChatList(page);
  await nav(page, 'Feeds');
  await page.getByTestId('feed-item').filter({ hasText: 'Sicherheit Testartikel' }).getByRole('button', { name: 'Agent fragen' }).click();
  await expect(page.getByTestId('chat-context')).toContainText('nicht vertrauenswürdige Daten');
  await send(page, 'Ist das seriös?');
  await expect(page.getByTestId('message-assistant').last()).toContainText('Deine Nachricht beginnt mit: «Ist das seriös?');
  const feedTurn = (await turns()).at(-1)!;
  expect(feedTurn.messages.at(-1)!.content).toContain('<<<ZITAT');

  // Start a new chat.
  await toChatList(page);
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

  await page.goto('/chat?neu');
  await send(page, `Frage A ${tag}`);
  await expect(page.getByTestId('message-user')).toContainText(`Frage A ${tag}`);
  await toChatList(page);
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
  await page.goto('/chat?neu');
  await send(page, `Bist du da? ${tag}`);
  const error = page.getByTestId('message-error');
  await expect(error).toContainText('Der Agent ist nicht erreichbar.');
  await expect(error.getByRole('button', { name: 'Erneut versuchen' })).toBeVisible();

  // Everything else still works.
  await toChatList(page);
  await nav(page, 'Heute');
  await expect(page.getByRole('heading', { name: 'Aufgaben', level: 2 })).toBeVisible();
  await nav(page, 'Aufgaben');
  await addTask(page, { title: `Trotz Agent-Ausfall ${tag}` });
  await expect(page.getByTestId('task').filter({ hasText: `Trotz Agent-Ausfall ${tag}` })).toBeVisible();
  await nav(page, 'Feeds');
  await expect(page.getByRole('button', { name: 'Aktualisieren' })).toBeEnabled();
  await nav(page, 'Mehr');
  await expect(page.getByRole('button', { name: 'Neue Quelle' })).toBeVisible();

  // Agent back: retry succeeds.
  await control('/agent/start');
  await nav(page, 'Chat');
  await page.getByRole('link', { name: new RegExp(`Bist du da\\? ${tag}`) }).click();
  await page.getByRole('button', { name: 'Erneut versuchen' }).click();
  await expect(page.getByTestId('message-assistant')).toContainText('Antwort vom Test-Agenten');
  await expect(page.getByTestId('message-error')).toHaveCount(0);
});

test('chat list: pin, snooze, settle, reactivate, rename and delete through the actions menu', async ({ page, request }, info) => {
  const tag = `${info.project.name}-${Date.now()}`;
  const client = api(request);
  const thread = await client.post<{ id: number }>('/chat/threads', {});
  await client.post(`/chat/threads/${thread.id}/messages`, { content: `Zustände ${tag}` });
  const state = async () => (await client.get<{ thread: { state: string; title: string } }>(`/chat/threads/${thread.id}`)).thread;
  const menu = page.getByRole('dialog');
  const act = async (title: string, ...steps: string[]) => {
    await page.getByRole('button', { name: `Aktionen: ${title}` }).first().click();
    for (const step of steps) await menu.getByRole('button', { name: step, exact: true }).click();
    await expect(menu).toBeHidden();
  };

  await page.goto('/chat');
  const title = `Zustände ${tag}`;
  await act(title, 'Anheften');
  await expect(page.getByRole('heading', { name: 'Angeheftet', level: 2 })).toBeVisible();
  expect((await state()).state).toBe('pinned');

  await act(title, 'Schlummern …', 'In 1 Stunde');
  expect((await state()).state).toBe('snoozed');
  await page.getByRole('button', { name: /^Schlummernd/ }).click();
  await expect(page.getByTestId('thread').filter({ hasText: title })).toContainText('bis ');

  await act(title, 'Erledigt');
  expect((await state()).state).toBe('settled');
  await page.getByRole('button', { name: /^Erledigt \d/ }).click();
  await act(title, 'Wieder aktivieren');
  expect((await state()).state).toBe('active');

  await page.getByRole('button', { name: `Aktionen: ${title}` }).click();
  await menu.getByRole('button', { name: 'Umbenennen' }).click();
  await menu.getByLabel('Titel').fill(`Umbenannt ${tag}`);
  await menu.getByRole('button', { name: 'Speichern' }).click();
  await expect(page.getByTestId('thread').filter({ hasText: `Umbenannt ${tag}` })).toBeVisible();

  await act(`Umbenannt ${tag}`, 'Löschen', 'Löschen');
  await expect(page.getByTestId('thread').filter({ hasText: `Umbenannt ${tag}` })).toHaveCount(0);
});

test('a long press on the agent button starts a new chat; a short tap opens the list', async ({ page }) => {
  await page.goto('/');
  const agent = page.getByRole('navigation', { name: 'Hauptnavigation' }).getByRole('link', { name: 'Chat', exact: true });

  await agent.click();
  await expect(page).toHaveURL(/\/chat$/);
  await expect(page.getByRole('heading', { name: 'Chat', level: 1 })).toBeVisible();

  await page.goto('/');
  const box = (await agent.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await expect(page).toHaveURL(/\/chat\?neu$/);
  await page.mouse.up();
  await expect(page).toHaveURL(/\/chat\?neu$/);
  await expect(page.getByLabel('Nachricht')).toBeFocused();
});

test('streams replies live with MCP tool trace, reconnects on reload and chat switch, and persists collapsed trace', async ({
  page,
  request,
}, info) => {
  const tag = `${info.project.name}-${Date.now()}`;
  const client = api(request);
  const other = await client.post<{ id: number }>('/chat/threads', {});
  await client.post(`/chat/threads/${other.id}/messages`, { content: `Nebenthema ${tag}` });
  const foreign = watchForeignRequests(page);

  await control('/agent/mode', { mode: 'sse', hold: true });
  await page.goto('/chat?neu');
  await send(page, `Stream-Test ${tag}`);

  // Before the agent finishes: live tool trace and first streamed chunk are visible.
  const liveTrace = page.getByTestId('live-tool-trace');
  await expect(liveTrace).toContainText('Offene Aufgaben gelesen');
  await expect(liveTrace).toContainText('Feeds gelesen');
  const streaming = page.getByTestId('message-assistant-streaming');
  await expect(streaming).toContainText('Antwort vom Test-Agenten.');
  await expect(streaming).not.toContainText('Deine Nachricht beginnt mit:');

  // Reloading mid-stream reconnects and still shows the ongoing draft and live tool trace.
  await page.reload();
  await expect(page.getByTestId('live-tool-trace')).toContainText('Offene Aufgaben gelesen');
  await expect(page.getByTestId('message-assistant-streaming')).toContainText('Antwort vom Test-Agenten.');

  // Switching to another chat mid-stream does not leak chunks; returning reconnects cleanly.
  const activeUrl = page.url();
  await toChatList(page);
  await page.locator(`a[href="/chat?thread=${other.id}"]`).click();
  await expect(page.getByTestId('message-user').first()).toContainText(`Nebenthema ${tag}`);
  await expect(page.getByTestId('message-assistant-streaming')).toHaveCount(0);
  await page.goto(activeUrl);
  await expect(page.getByTestId('message-assistant-streaming')).toContainText('Antwort vom Test-Agenten.');

  // Release stream -> completes with full sanitized reply and collapsed persisted tool trace.
  await control('/agent/release');
  const reply = page.getByTestId('message-assistant').last();
  await expect(reply).toContainText('Deine Nachricht beginnt mit: «Stream-Test');
  await expect(page.getByTestId('message-assistant-streaming')).toHaveCount(0);
  await expect(reply.locator('script, img')).toHaveCount(0);
  expect(await page.evaluate(() => (window as unknown as { __xss?: number }).__xss)).toBeUndefined();

  const trace = reply.getByTestId('tool-trace');
  await expect(trace).toBeVisible();
  await expect(trace).not.toHaveAttribute('open', '');
  await trace.locator('summary').click();
  await expect(trace).toHaveAttribute('open', '');
  await expect(trace).toContainText('Offene Aufgaben gelesen');
  await expect(trace).toContainText('Feeds gelesen');

  // Persisted trace survives reload and starts collapsed again.
  await page.reload();
  const reloadedTrace = page.getByTestId('message-assistant').last().getByTestId('tool-trace');
  await expect(reloadedTrace).toBeVisible();
  await expect(reloadedTrace).not.toHaveAttribute('open', '');
  await reloadedTrace.locator('summary').click();
  await expect(reloadedTrace).toContainText('Offene Aufgaben gelesen');

  expect(foreign).toEqual([]);
});

test('a long reply keeps its start in view, the header dot shows the turn and «Neuster Text» jumps to the end', async ({ page }, info) => {
  const tag = `${info.project.name}-${Date.now()}`;
  await control('/agent/mode', { mode: 'sse', hold: true });
  await page.goto('/chat?neu');
  await send(page, `Lange Antwort bitte ${tag}`);

  // While streaming, new words are wrapped so they can fade in, and the header dot turns hollow.
  const streaming = page.getByTestId('message-assistant-streaming');
  await expect(streaming).toContainText('Antwort vom Test-Agenten.');
  await expect(streaming.locator('.w').first()).toBeAttached();
  // The thin writing cursor sits after the last block.
  const cursor = await streaming.evaluate((el) => {
    const last = el.lastElementChild;
    const block = last && /^(UL|OL)$/.test(last.tagName) ? last.lastElementChild : last;
    return block ? getComputedStyle(block, '::after').content : 'none';
  });
  expect(cursor).not.toBe('none');
  await expect(page.locator('.conv-head .dot')).toHaveClass(/writing/);

  await control('/agent/release');
  const reply = page.getByTestId('message-assistant').last();
  await expect(reply).toContainText('Absatz 40 der langen Antwort.');
  await expect(page.locator('.conv-head .dot')).not.toHaveClass(/writing|thinking/);

  // The start of the reply stays visible instead of the view following the end.
  const log = page.getByTestId('chat-log');
  const position = () =>
    log.evaluate((el) => {
      const last = Array.from(el.querySelectorAll('[data-testid="message-assistant"]')).at(-1)!;
      const top = last.getBoundingClientRect().top - el.getBoundingClientRect().top;
      return { top, height: el.clientHeight, below: el.scrollHeight - el.scrollTop - el.clientHeight };
    });
  const before = await position();
  expect(before.top).toBeGreaterThanOrEqual(-1);
  expect(before.top).toBeLessThan(before.height);
  expect(before.below).toBeGreaterThan(100);

  const jump = page.getByRole('button', { name: 'Neuster Text' });
  await jump.click();
  await expect(jump).toBeHidden();
  await expect.poll(async () => (await position()).below).toBeLessThan(48);
});

test('falls back for non-streaming agents and discards partial drafts on mid-stream failure with working retry', async ({ page }, info) => {
  const tag = `${info.project.name}-${Date.now()}`;

  // Non-streaming JSON agent fallback.
  await control('/agent/mode', { mode: 'json', hold: false });
  await page.goto('/chat?neu');
  await send(page, `JSON-Fallback ${tag}`);
  await expect(page.getByTestId('message-assistant').last()).toContainText(`JSON-Fallback ${tag}`);

  // Mid-stream disconnect: partial draft is discarded, German error shown, retry succeeds.
  await control('/agent/mode', { mode: 'fail-mid-stream', hold: false });
  await send(page, `Abbruch-Test ${tag}`);
  const err = page.getByTestId('message-error');
  await expect(err).toContainText('Der Agent ist nicht erreichbar.');
  await expect(page.getByTestId('message-assistant-streaming')).toHaveCount(0);
  await expect(page.getByTestId('message-assistant')).toHaveCount(1);

  await control('/agent/mode', { mode: 'sse', hold: false });
  await err.getByRole('button', { name: 'Erneut versuchen' }).click();
  await expect(page.getByTestId('message-error')).toHaveCount(0);
  await expect(page.getByTestId('message-assistant').last()).toContainText(`Abbruch-Test ${tag}`);
});
