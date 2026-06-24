import { expect, test } from '@playwright/test';
import { registerViaApi } from './helpers/api';
import { registerViaUi } from './helpers/ui';

test('создание direct-чата по username', async ({ page }) => {
  // Собеседник существует на сервере
  const b = await registerViaApi();

  // A регистрируется через UI
  await registerViaUi(page);

  // Изначально чатов нет
  await expect(page.getByTestId('chat-list')).toContainText('Чатов пока нет');

  // Синяя «+» открывает диалог нового чата
  await page.getByTestId('new-chat-button').click();
  await expect(page.getByTestId('new-chat-dialog')).toBeVisible();

  // A создаёт direct к B по username
  await page.getByTestId('new-chat-input').fill(b.username);
  await page.getByTestId('new-chat-submit').click();

  // Диалог закрылся, чат появился в списке именем B и стал выбранным
  await expect(page.getByTestId('new-chat-dialog')).toHaveCount(0);
  const items = page.getByTestId('chat-item');
  await expect(items).toHaveCount(1);
  await expect(items.first()).toContainText(b.username);

  // Несуществующий пользователь -> понятная ошибка прямо в диалоге
  await page.getByTestId('new-chat-button').click();
  await page.getByTestId('new-chat-input').fill('no_such_user_xyz');
  await page.getByTestId('new-chat-submit').click();
  await expect(page.getByTestId('new-chat-error')).toContainText(
    'Пользователь не найден',
  );
});
