import { expect, test, type Locator, type Page } from '@playwright/test';
import { addTask, api, fixturesForApp, nav, removeAllSources } from './support.ts';

/**
 * Performs a real touch gesture through CDP so Chromium exercises `touch-action: pan-y`,
 * pointer capture, vertical scrolling and click suppression just like an Android device.
 */
async function touchDrag(page: Page, target: Locator, dx: number, dy: number, steps = 10): Promise<void> {
  await target.scrollIntoViewIfNeeded();
  const box = (await target.boundingBox())!;
  const startX = Math.round(box.x + Math.min(Math.max(box.width * 0.5, 60), box.width - 60));
  const startY = Math.round(box.y + Math.min(box.height * 0.5, 48));
  const cdp = await page.context().newCDPSession(page);
  try {
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ x: startX, y: startY, id: 1 }],
    });
    for (let i = 1; i <= steps; i++) {
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ x: Math.round(startX + (dx * i) / steps), y: Math.round(startY + (dy * i) / steps), id: 1 }],
      });
    }
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchEnd',
      touchPoints: [],
    });
  } finally {
    await cdp.detach();
  }
}

test('feed-to-task button prefills Neue Aufgabe sheet, cancels cleanly, and marks item read on save', async ({ page, request }, info) => {
  await removeAllSources(request);
  const client = api(request);
  await client.post('/feeds/sources', { url: `${await fixturesForApp()}/feeds/news.xml` });

  await page.goto('/feeds');
  const entries = page.getByTestId('feed-item');
  const target = entries.filter({ hasText: 'Meldung 2:' });
  await expect(target).toBeVisible();

  // Open prefilled sheet and cancel: no task created, entry stays unread.
  await target.getByRole('button', { name: 'Aufgabe', exact: true }).click();
  const sheet = page.getByRole('dialog', { name: 'Neue Aufgabe' });
  await expect(sheet).toBeVisible();
  await expect(sheet.getByLabel('Titel')).toHaveValue(/Meldung 2:/);
  await expect(sheet.getByLabel('Notiz (optional)')).toHaveValue(/Quelle: Testnachrichten\nhttps?:\/\//);
  await sheet.getByRole('button', { name: 'Schliessen' }).click();
  await expect(sheet).toBeHidden();
  await expect(target).toBeVisible();

  // Submit: creates task and marks feed item as read.
  const uniqueTitle = `Aus Feed ${info.project.name}-${Date.now()}`;
  await target.getByRole('button', { name: 'Aufgabe', exact: true }).click();
  await sheet.getByLabel('Titel').fill(uniqueTitle);
  await sheet.getByRole('button', { name: 'Hinzufügen' }).click();
  await expect(sheet).toBeHidden();
  await expect(entries.filter({ hasText: 'Meldung 2:' })).toHaveCount(0);

  // Regular read button still toggles in place under «Ungelesen».
  const third = entries.filter({ hasText: 'Meldung 3:' });
  await third.getByRole('button', { name: 'Als gelesen markieren' }).click();
  await expect(third.getByRole('button', { name: 'Als ungelesen markieren' })).toBeVisible();

  // Task is saved under Aufgaben with the source and URL in its note.
  await nav(page, 'Aufgaben');
  const created = page.getByTestId('task').filter({ hasText: uniqueTitle });
  await expect(created).toBeVisible();
  await expect(created).toContainText('Quelle: Testnachrichten');
});

test.describe('mobile touch swipe triage', () => {
  test.beforeEach(({ isMobile }, info) => {
    test.skip(!isMobile || info.project.name !== 'mobile', 'Touch swipe gestures are exercised on the 390px mobile project');
  });

  test('feeds: swipe right removes unread item with undo, vertical scroll ignores swipe, swipe left reveals Merken and Aufgabe', async ({
    page,
    request,
  }) => {
    await removeAllSources(request);
    const client = api(request);
    await client.post('/feeds/sources', { url: `${await fixturesForApp()}/feeds/news.xml` });

    await page.goto('/feeds');
    const entries = page.getByTestId('feed-item');
    const first = entries.filter({ hasText: 'Meldung 2:' });
    const second = entries.filter({ hasText: 'Meldung 3:' });
    await expect(first).toBeVisible();

    // Vertical scroll gesture must not mark read or open swipe actions.
    await touchDrag(page, first, 12, -110);
    await expect(first).toBeVisible();
    await expect(first).not.toHaveAttribute('data-swipe-open', 'true');
    await expect(page.getByTestId('undo-toast')).toHaveCount(0);

    // Swipe right: marks read, removes from «Ungelesen», shows Undo; tapping Undo restores it.
    await touchDrag(page, first, 150, 4);
    await expect(entries.filter({ hasText: 'Meldung 2:' })).toHaveCount(0);
    const toast = page.getByTestId('undo-toast');
    await expect(toast).toContainText('Als gelesen markiert');
    await toast.getByRole('button', { name: 'Rückgängig' }).click();
    await expect(entries.filter({ hasText: 'Meldung 2:' })).toBeVisible();

    // Swipe right without Undo persists across reload.
    await touchDrag(page, entries.filter({ hasText: 'Meldung 2:' }), 150, 0);
    await expect(entries.filter({ hasText: 'Meldung 2:' })).toHaveCount(0);
    await page.reload();
    await expect(entries.filter({ hasText: 'Meldung 2:' })).toHaveCount(0);

    // Swipe left opens Merken & Aufgabe; opening another row closes the previous one.
    await touchDrag(page, second, -130, 0);
    await expect(second).toHaveAttribute('data-swipe-open', 'true');
    const third = entries.filter({ hasText: 'Meldung 4:' });
    await touchDrag(page, third, -130, 0);
    await expect(third).toHaveAttribute('data-swipe-open', 'true');
    await expect(second).not.toHaveAttribute('data-swipe-open', 'true');

    // Tap «Merken» inside left-swipe tray toggles bookmark and closes the row.
    await third.getByTestId('swipe-actions').getByRole('button', { name: 'Merken' }).click();
    await expect(third).not.toHaveAttribute('data-swipe-open', 'true');
    await expect(third.getByRole('button', { name: 'Merken' })).toHaveAttribute('aria-pressed', 'true');

    // Tap «Aufgabe» inside left-swipe tray creates task and marks entry read.
    await touchDrag(page, second, -130, 0);
    await second.getByTestId('swipe-actions').getByRole('button', { name: 'Aufgabe' }).click();
    const sheet = page.getByRole('dialog', { name: 'Neue Aufgabe' });
    const title = `Swipe Aufgabe ${Date.now()}`;
    await sheet.getByLabel('Titel').fill(title);
    await sheet.getByRole('button', { name: 'Hinzufügen' }).click();
    await expect(sheet).toBeHidden();
    await expect(entries.filter({ hasText: 'Meldung 3:' })).toHaveCount(0);

    await nav(page, 'Aufgaben');
    await expect(page.getByTestId('task').filter({ hasText: title })).toBeVisible();

    // With «Ungelesen» off, right-swipe toggles read/unread in place.
    await nav(page, 'Feeds');
    await page.getByRole('button', { name: 'Ungelesen' }).click();
    const archived = entries.filter({ hasText: 'Meldung 2:' });
    await expect(archived).toBeVisible();
    await touchDrag(page, archived, 150, 0);
    await expect(page.getByTestId('undo-toast')).toContainText('Als ungelesen markiert');
    await expect(archived).toBeVisible();
  });

  test('tasks: swipe right completes/reopens with undo, swipe left reveals Bearbeiten and Löschen with confirmation', async ({ page }) => {
    const tag = `swipe-${Date.now()}`;
    await page.goto('/aufgaben');
    await addTask(page, { title: `Wisch-Aufgabe ${tag}` });

    const row = page.getByTestId('task').filter({ hasText: `Wisch-Aufgabe ${tag}` });
    await expect(row).toBeVisible();

    // Swipe right completes open task; Undo restores it.
    await touchDrag(page, row, 150, 0);
    await expect(row).toHaveCount(0);
    const toast = page.getByTestId('undo-toast');
    await expect(toast).toContainText('Aufgabe erledigt');
    await toast.getByRole('button', { name: 'Rückgängig' }).click();
    await expect(row).toBeVisible();

    // Complete again, then reopen from «Erledigt» by swiping right.
    await touchDrag(page, row, 150, 0);
    await expect(row).toHaveCount(0);
    await page.getByRole('button', { name: 'Erledigt', exact: true }).click();
    await expect(row).toBeVisible();
    await touchDrag(page, row, 150, 0);
    await expect(row).toHaveCount(0);
    await expect(page.getByTestId('undo-toast')).toContainText('Aufgabe wieder geöffnet');
    await page.getByRole('button', { name: 'Offen', exact: true }).click();
    await expect(row).toBeVisible();

    // Swipe left -> Bearbeiten opens inline edit form.
    await touchDrag(page, row, -130, 0);
    await row.getByTestId('swipe-actions').getByRole('button', { name: 'Bearbeiten' }).click();
    await row.getByLabel('Titel').fill(`Bearbeitet ${tag}`);
    await row.getByRole('button', { name: 'Speichern' }).click();
    const edited = page.getByTestId('task').filter({ hasText: `Bearbeitet ${tag}` });
    await expect(edited).toBeVisible();

    // Swipe left -> Löschen shows confirmation without deleting immediately.
    await touchDrag(page, edited, -130, 0);
    await edited.getByTestId('swipe-actions').getByRole('button', { name: 'Löschen' }).click();
    await expect(edited).toContainText('Aufgabe löschen?');
    await edited.getByRole('button', { name: 'Löschen', exact: true }).click();
    await expect(edited).toHaveCount(0);
  });

  test('chat list: swipe right settles/reactivates with undo, swipe left reveals Schlummern/Aufwecken and Anheften', async ({
    page,
    request,
  }) => {
    const tag = `swipe-chat-${Date.now()}`;
    const client = api(request);
    const created = await client.post<{ id: number }>('/chat/threads', {});
    await client.post(`/chat/threads/${created.id}/messages`, { content: `Wisch-Chat ${tag}` });
    const title = `Wisch-Chat ${tag}`;
    const state = async () => (await client.get<{ thread: { state: string } }>(`/chat/threads/${created.id}`)).thread.state;

    await page.goto('/chat');
    const row = page.getByTestId('thread').filter({ hasText: title });
    await expect(row).toBeVisible();

    // Swipe right settles active chat; Undo restores it to active.
    await touchDrag(page, row, 150, 0);
    expect(await state()).toBe('settled');
    const toast = page.getByTestId('undo-toast');
    await expect(toast).toContainText('Chat erledigt');
    await toast.getByRole('button', { name: 'Rückgängig' }).click();
    await expect(row).toBeVisible();
    expect(await state()).toBe('active');

    // Swipe left -> Anheften pins the chat.
    await touchDrag(page, row, -130, 0);
    await row.getByTestId('swipe-actions').getByRole('button', { name: 'Anheften' }).click();
    await expect(page.getByRole('heading', { name: 'Angeheftet', level: 2 })).toBeVisible();
    expect(await state()).toBe('pinned');

    // Swipe right on pinned chat settles it; Undo restores pinned state!
    await touchDrag(page, row, 150, 0);
    expect(await state()).toBe('settled');
    await page.getByTestId('undo-toast').getByRole('button', { name: 'Rückgängig' }).click();
    await expect(page.getByRole('heading', { name: 'Angeheftet', level: 2 })).toBeVisible();
    expect(await state()).toBe('pinned');

    // Swipe left -> Schlummern opens snooze presets directly.
    await touchDrag(page, row, -130, 0);
    await row.getByTestId('swipe-actions').getByRole('button', { name: 'Schlummern' }).click();
    const sheet = page.getByRole('dialog');
    await expect(sheet).toBeVisible();
    await sheet.getByRole('button', { name: 'In 1 Stunde' }).click();
    await expect(sheet).toBeHidden();
    expect(await state()).toBe('snoozed');

    // Expand Schlummernd -> swipe left reveals Aufwecken -> wakes back to active.
    await page.getByRole('button', { name: /^Schlummernd/ }).click();
    await expect(row).toBeVisible();
    await touchDrag(page, row, -130, 0);
    await row.getByTestId('swipe-actions').getByRole('button', { name: 'Aufwecken' }).click();
    expect(await state()).toBe('active');
  });
});
