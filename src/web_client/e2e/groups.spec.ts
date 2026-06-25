import { expect, test } from '@playwright/test';
import { registerViaApi } from './helpers/api';
import { createDirectViaUi, registerViaUi } from './helpers/ui';

test('создание группы с участниками из знакомых пользователей', async ({
  page,
}) => {
  // Два будущих участника существуют на сервере
  const b = await registerViaApi();
  const c = await registerViaApi();

  // A регистрируется через UI
  await registerViaUi(page);

  // Участников группы выбирают из тех, с кем уже есть личный чат — заводим их
  await createDirectViaUi(page, b.username);
  await createDirectViaUi(page, c.username);

  // Синяя «+» -> вкладка «Новая группа»
  await page.getByTestId('new-chat-button').click();
  await page.getByTestId('new-chat-tab-group').click();

  // Название + выбор двух участников из списка знакомых
  await page.getByTestId('new-group-title').fill('Команда');
  await page
    .getByTestId('new-group-option')
    .filter({ hasText: b.username })
    .click();
  await page
    .getByTestId('new-group-option')
    .filter({ hasText: c.username })
    .click();
  // Выбранные стали чипами; в списке кандидатов их больше нет
  await expect(page.getByTestId('group-member')).toHaveCount(2);
  await page.getByTestId('new-group-submit').click();

  // Диалог закрылся, группа появилась под своим названием и открыта
  await expect(page.getByTestId('new-chat-dialog')).toHaveCount(0);
  const items = page.getByTestId('chat-item');
  await expect(items.filter({ hasText: 'Команда' })).toHaveCount(1);

  // Поиск отфильтровывает кандидатов по подстроке username
  await page.getByTestId('new-chat-button').click();
  await page.getByTestId('new-chat-tab-group').click();
  await page.getByTestId('new-group-search').fill(b.username);
  await expect(page.getByTestId('new-group-option')).toHaveCount(1);
  await expect(page.getByTestId('new-group-option')).toContainText(b.username);

  // Группа без участников создаваться не должна — понятная ошибка
  await page.getByTestId('new-group-search').fill('');
  await page.getByTestId('new-group-title').fill('Призраки');
  await page.getByTestId('new-group-submit').click();
  await expect(page.getByTestId('new-chat-error')).toContainText(
    'Добавьте хотя бы одного участника',
  );
});

test('новому пользователю без чатов подсказка вместо списка участников', async ({
  page,
}) => {
  await registerViaUi(page);
  await page.getByTestId('new-chat-button').click();
  await page.getByTestId('new-chat-tab-group').click();
  // Знакомых пользователей нет — показываем подсказку, списка нет
  await expect(page.getByTestId('new-group-hint')).toBeVisible();
  await expect(page.getByTestId('new-group-options')).toHaveCount(0);
});
