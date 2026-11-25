import { expect, test } from '@playwright/test';
import { civilToday, control, nav } from './support.ts';

test('creates, edits, filters, completes and deletes tasks; they survive a restart and show on Heute', async ({ page }, info) => {
  const tag = `${info.project.name}-${Date.now()}`;
  const list = `Liste-${tag}`;
  await page.goto('/aufgaben');

  // Create: one due today in a list, one without details.
  await page.getByPlaceholder('Neue Aufgabe').fill(`Rechnung zahlen ${tag}`);
  await page.locator('input[name="dueDate"]').fill(civilToday());
  await page.locator('input[name="category"]').fill(list);
  await page.getByRole('button', { name: 'Hinzufügen', exact: true }).click();
  await expect(page.getByTestId('task').filter({ hasText: `Rechnung zahlen ${tag}` })).toBeVisible();
  await page.getByPlaceholder('Neue Aufgabe').fill(`Velo putzen ${tag}`);
  await page.locator('input[name="category"]').fill('');
  await page.getByRole('button', { name: 'Hinzufügen', exact: true }).click();

  const due = page.getByTestId('task').filter({ hasText: `Rechnung zahlen ${tag}` });
  const bike = page.getByTestId('task').filter({ hasText: `Velo putzen ${tag}` });
  await expect(due).toContainText('Heute');
  await expect(due).toContainText(list);
  await expect(bike).toBeVisible();

  // Edit.
  await bike.getByRole('button', { name: /^Bearbeiten/ }).click();
  await page.getByLabel('Titel').fill(`Velo service ${tag}`);
  await page.getByLabel('Notiz').fill('Kette ölen');
  await page.getByRole('button', { name: 'Speichern' }).click();
  const serviced = page.getByTestId('task').filter({ hasText: `Velo service ${tag}` });
  await expect(serviced).toContainText('Kette ölen');

  // Filter by list.
  await page.locator('#category-filter').selectOption(list);
  await expect(page.getByTestId('task')).toHaveCount(1);
  await expect(due).toBeVisible();
  await page.locator('#category-filter').selectOption('');

  // Complete: leaves "Offen", shows under "Erledigt".
  await serviced.getByRole('checkbox').check();
  await expect(serviced).toHaveCount(0);
  await page.getByRole('button', { name: 'Erledigt', exact: true }).click();
  await expect(page.getByTestId('task').filter({ hasText: `Velo service ${tag}` })).toBeVisible();

  // Delete.
  const doomed = page.getByTestId('task').filter({ hasText: `Velo service ${tag}` });
  await doomed.getByRole('button', { name: /^Löschen:/ }).click();
  await doomed.getByRole('button', { name: 'Löschen', exact: true }).click();
  await expect(page.getByTestId('task').filter({ hasText: `Velo service ${tag}` })).toHaveCount(0);

  // Restart Life Hub (process or container) and check persistence.
  await control('/app/restart');
  await page.goto('/aufgaben');
  await expect(page.getByTestId('task').filter({ hasText: `Rechnung zahlen ${tag}` })).toBeVisible();

  // Due today appears on Heute.
  await nav(page, 'Heute');
  await expect(page.getByRole('heading', { name: 'Heute fällig' })).toBeVisible();
  await expect(page.getByTestId('task').filter({ hasText: `Rechnung zahlen ${tag}` })).toBeVisible();
});
