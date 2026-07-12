import { expect, test } from '@playwright/test';
import { createDirectViaUi, registerViaUi } from './helpers/ui';

test('черновик сохраняется и восстанавливается после перезагрузки', async ({
  page,
  browser,
}) => {
  const a = await registerViaUi(page);
  const b = await registerViaUi(page);

  // A создаёт direct к B
  await createDirectViaUi(page, b.username);
  await expect(page.getByTestId('conversation-open')).toBeVisible();

  // Вводим текст (но не отправляем)
  await page.getByTestId('message-input').fill('черновик для теста');

  // Ждём debounce (1500ms) + буфер
  await page.waitForTimeout(2500);

  // Перезагружаем страницу
  await page.reload();
  await expect(page.getByTestId('chat-list')).toBeVisible();

  // Открываем тот же чат
  const chatItem = page.getByTestId('chat-item').filter({ hasText: b.username });
  await expect(chatItem).toBeVisible();
  await chatItem.click();
  await expect(page.getByTestId('conversation-open')).toBeVisible();

  // Проверяем, что черновик восстановился
  await expect(page.getByTestId('message-input')).toHaveValue('черновик для теста');
});
