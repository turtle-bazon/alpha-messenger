import { expect, test } from '@playwright/test';
import { createDirectViaUi, registerViaUi } from './helpers/ui';

test('живая доставка сообщения между двумя пользователями', async ({
  browser,
}) => {
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const pageA = await ctxA.newPage();
  const pageB = await ctxB.newPage();

  const a = await registerViaUi(pageA);
  const b = await registerViaUi(pageB);

  // A создаёт direct к B — чат авто-выбирается и открывается
  await createDirectViaUi(pageA, b.username);
  await expect(pageA.getByTestId('conversation-open')).toBeVisible();

  // B видит появившийся чат (chat.created по WS) и открывает его
  const bChat = pageB
    .getByTestId('chat-item')
    .filter({ hasText: a.username });
  await expect(bChat).toBeVisible();
  await bChat.click();
  await expect(pageB.getByTestId('conversation-open')).toBeVisible();

  // A отправляет — у A своё сообщение, у B оно появляется вживую по WS
  await pageA.getByTestId('message-input').fill('привет, B');
  await pageA.getByTestId('message-send').click();
  await expect(pageA.getByTestId('messages')).toContainText('привет, B');
  await expect(pageB.getByTestId('messages')).toContainText('привет, B');

  // Ответ B -> приходит к A вживую
  await pageB.getByTestId('message-input').fill('привет, A');
  await pageB.getByTestId('message-send').click();
  await expect(pageB.getByTestId('messages')).toContainText('привет, A');
  await expect(pageA.getByTestId('messages')).toContainText('привет, A');

  await ctxA.close();
  await ctxB.close();
});
