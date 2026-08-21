import { expect, test } from '@playwright/test';
import { registerViaApi } from './helpers/api';
import { createDirectViaUi, registerViaUi } from './helpers/ui';

async function createGroupViaUi(
  page: import('@playwright/test').Page,
  title: string,
  usernames: string[],
): Promise<void> {
  for (const u of usernames) {
    await createDirectViaUi(page, u);
  }
  await page.getByTestId('new-chat-button').click();
  await page.getByTestId('new-chat-tab-group').click();
  await page.getByTestId('new-group-title').fill(title);
  for (const u of usernames) {
    await page.getByTestId('new-group-option').filter({ hasText: u }).click();
  }
  await page.getByTestId('new-group-submit').click();
  await expect(page.getByTestId('new-chat-dialog')).toHaveCount(0);
}

// Владелец группы: клик по заголовку → GroupInfoDialog → редактирование
test('group info: owner can edit title and description', async ({ page }) => {
  const b = await registerViaApi();
  await registerViaUi(page);

  await createGroupViaUi(page, 'Test Group', [b.username]);
  await page.getByTestId('chat-item').first().click();
  await expect(page.getByTestId('conversation-open')).toBeVisible();

  // Клик по заголовку группы → GroupInfoDialog
  await page.getByTestId('conv-header-info').click();
  await expect(page.getByTestId('group-info-dialog')).toBeVisible();

  // Owner видит инпуты для редактирования
  await expect(page.getByTestId('group-info-title')).toBeVisible();
  await expect(page.getByTestId('group-info-description')).toBeVisible();
  await expect(page.getByTestId('group-info-members')).toBeVisible();

  // Меняем описание
  await page.getByTestId('group-info-description').fill('Test description');
  await page.waitForTimeout(1500);

  // Закрываем диалог
  await page.getByTestId('group-info-close').click();
  await expect(page.getByTestId('group-info-dialog')).toHaveCount(0);

  // Повторно открываем — описание сохранилось
  await page.getByTestId('conv-header-info').click();
  await expect(page.getByTestId('group-info-dialog')).toBeVisible();
  await expect(page.getByTestId('group-info-description')).toHaveValue(
    'Test description',
  );

  // Кнопка «Участники» открывает MembersDialog
  await page.getByTestId('group-info-members').click();
  await expect(page.getByTestId('members-dialog')).toBeVisible();
});

// Участник (не owner): клик по заголовку → GroupInfoDialog → только просмотр
test('group info: non-owner sees read-only view', async ({ browser }) => {
  const ctxA = await browser.newContext({ locale: 'ru-RU' });
  const ctxB = await browser.newContext({ locale: 'ru-RU' });
  const pageA = await ctxA.newPage();
  const pageB = await ctxB.newPage();

  const b = await registerViaApi();
  await registerViaUi(pageA);
  await registerViaUi(pageB);

  // A создаёт группу с B
  await createGroupViaUi(pageA, 'My Group', [b.username]);
  await pageA.getByTestId('chat-item').first().click();
  await expect(pageA.getByTestId('conversation-open')).toBeVisible();

  // B видит группу и открывает
  await pageB.getByTestId('chat-item').first().click();
  await expect(pageB.getByTestId('conversation-open')).toBeVisible();

  // B кликает по заголовку → GroupInfoDialog (read-only)
  await pageB.getByTestId('conv-header-info').click();
  await expect(pageB.getByTestId('group-info-dialog')).toBeVisible();

  // B не видит инпуты для редактирования
  await expect(pageB.getByTestId('group-info-title')).toHaveCount(0);
  await expect(pageB.getByTestId('group-info-description')).toHaveCount(0);

  // B видит название и описание
  await expect(pageB.locator('.profile-username')).toHaveText('My Group');

  await ctxA.close();
  await ctxB.close();
});
