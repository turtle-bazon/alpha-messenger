import { expect, test } from '@playwright/test';
import { registerViaApi } from './helpers/api';
import { createDirectViaUi, registerViaUi } from './helpers/ui';

// Item 19 (адаптив): на узкой (мобильной) ширине показывается один экран —
// список ИЛИ переписка, с кнопкой «назад» для возврата к списку.
test('мобильная раскладка: один экран и кнопка «назад»', async ({ browser }) => {
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 780 },
  });
  const page = await ctx.newPage();
  await registerViaUi(page);
  const peer = await registerViaApi();

  // Пока чат не выбран — виден список, переписки нет.
  await expect(page.getByTestId('chat-list')).toBeVisible();
  await expect(page.getByTestId('conversation-open')).toBeHidden();

  // Открываем чат → на мобильной ширине список скрывается, видна переписка.
  await createDirectViaUi(page, peer.username);
  await expect(page.getByTestId('conversation-open')).toBeVisible();
  await expect(page.getByTestId('chat-list')).toBeHidden();

  // «Назад» → снова список, переписка скрыта.
  await page.getByTestId('conv-back').click();
  await expect(page.getByTestId('chat-list')).toBeVisible();
  await expect(page.getByTestId('conversation-open')).toBeHidden();
});
