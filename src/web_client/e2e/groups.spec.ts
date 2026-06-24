import { expect, test } from '@playwright/test';
import { registerViaApi } from './helpers/api';
import { registerViaUi } from './helpers/ui';

test('создание группы с участниками', async ({ page }) => {
  // Два будущих участника существуют на сервере
  const b = await registerViaApi();
  const c = await registerViaApi();

  // A регистрируется через UI
  await registerViaUi(page);

  // Синяя «+» -> вкладка «Новая группа»
  await page.getByTestId('new-chat-button').click();
  await page.getByTestId('new-chat-tab-group').click();

  // Название + два участника (один добавлен кнопкой, второй — оставлен в поле,
  // он подхватывается при отправке)
  await page.getByTestId('new-group-title').fill('Команда');
  await page.getByTestId('new-group-member').fill(b.username);
  await page.getByTestId('new-group-add').click();
  await expect(page.getByTestId('group-member')).toHaveText(
    new RegExp(b.username),
  );
  await page.getByTestId('new-group-member').fill(c.username);
  await page.getByTestId('new-group-submit').click();

  // Диалог закрылся, группа появилась под своим названием и открыта
  await expect(page.getByTestId('new-chat-dialog')).toHaveCount(0);
  const items = page.getByTestId('chat-item');
  await expect(items).toHaveCount(1);
  await expect(items.first()).toContainText('Команда');

  // Неизвестный участник -> понятная ошибка, диалог остаётся открытым
  await page.getByTestId('new-chat-button').click();
  await page.getByTestId('new-chat-tab-group').click();
  await page.getByTestId('new-group-title').fill('Призраки');
  await page.getByTestId('new-group-member').fill('no_such_user_xyz');
  await page.getByTestId('new-group-submit').click();
  await expect(page.getByTestId('new-chat-error')).toContainText(
    'Проверьте участников',
  );
});
