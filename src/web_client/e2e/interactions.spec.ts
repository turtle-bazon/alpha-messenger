import { expect, test } from '@playwright/test';
import { createDirectViaUi, registerViaUi } from './helpers/ui';

// Редактирование/удаление своих сообщений, отметка прочтения и typing —
// проверяем взаимодействие двух пользователей вживую по WS.
test('edit, delete, read и typing между двумя пользователями', async ({
  browser,
}) => {
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const pageA = await ctxA.newPage();
  const pageB = await ctxB.newPage();

  const a = await registerViaUi(pageA);
  const b = await registerViaUi(pageB);

  // Чат A↔B, оба открыли переписку
  await createDirectViaUi(pageA, b.username);
  await expect(pageA.getByTestId('conversation-open')).toBeVisible();
  await pageB.getByTestId('chat-item').filter({ hasText: a.username }).click();
  await expect(pageB.getByTestId('conversation-open')).toBeVisible();

  // A отправляет сообщение -> приходит к B
  await pageA.getByTestId('message-input').fill('исходное');
  await pageA.getByTestId('message-send').click();
  await expect(pageB.getByTestId('messages')).toContainText('исходное');

  // read: B открыл чат и прочитал -> у A статус становится «прочитано» (✓✓)
  await expect(pageA.getByTestId('msg-status')).toHaveText('✓✓');

  // typing: A набирает -> B видит индикатор
  await pageA.getByTestId('message-input').fill('печатаю...');
  await expect(pageB.getByTestId('typing-indicator')).toBeVisible();
  await pageA.getByTestId('message-input').fill('');

  // edit: A правит своё сообщение -> B видит новый текст и пометку «ред.»
  const ownBubble = pageA.getByTestId('message').filter({ hasText: 'исходное' });
  await ownBubble.hover();
  await ownBubble.getByTestId('msg-edit').click();
  await pageA.getByTestId('message-input').fill('исправленное');
  await pageA.getByTestId('message-send').click();
  await expect(pageB.getByTestId('messages')).toContainText('исправленное');
  await expect(pageB.getByTestId('messages')).toContainText('ред.');

  // delete: A удаляет -> B видит «Сообщение удалено»
  const edited = pageA.getByTestId('message').filter({ hasText: 'исправленное' });
  await edited.hover();
  await edited.getByTestId('msg-delete').click();
  await expect(pageB.getByTestId('messages')).toContainText('Сообщение удалено');
});
