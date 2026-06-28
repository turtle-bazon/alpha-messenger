import { expect, test } from '@playwright/test';
import { createDirectViaUi, createGroupViaUi, registerViaUi } from './helpers/ui';

// Задача #27: индикаторы на аватаре в ChatList — присутствие (онлайн/оффлайн)
// для личных чатов и окантовка «печатает» для личных и групповых.

test('ChatList: кружок присутствия в личном чате (онлайн → оффлайн)', async ({
  browser,
}) => {
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const pageA = await ctxA.newPage();
  const pageB = await ctxB.newPage();

  await registerViaUi(pageA);
  const b = await registerViaUi(pageB);

  await createDirectViaUi(pageA, b.username);
  await expect(pageA.getByTestId('conversation-open')).toBeVisible();

  const aItem = pageA.getByTestId('chat-item').filter({ hasText: b.username });
  // B онлайн → у A зелёный кружок.
  await expect(aItem.getByTestId('avatar-status')).toHaveAttribute(
    'data-status',
    'online',
  );

  // B уходит (закрываем вкладку) → presence offline → серый кружок.
  await ctxB.close();
  await expect(aItem.getByTestId('avatar-status')).toHaveAttribute(
    'data-status',
    'offline',
  );

  await ctxA.close();
});

test('ChatList: окантовка «печатает» в личном чате', async ({ browser }) => {
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const pageA = await ctxA.newPage();
  const pageB = await ctxB.newPage();

  const a = await registerViaUi(pageA);
  const b = await registerViaUi(pageB);

  await createDirectViaUi(pageA, b.username);
  await expect(pageA.getByTestId('conversation-open')).toBeVisible();
  await pageB.getByTestId('chat-item').filter({ hasText: a.username }).click();
  await expect(pageB.getByTestId('conversation-open')).toBeVisible();

  // A на главном экране (не открыт чат с B обязательно), B печатает.
  const aItem = pageA.getByTestId('chat-item').filter({ hasText: b.username });
  await expect(aItem.getByTestId('avatar-typing')).toHaveCount(0);

  await pageB.getByTestId('message-input').fill('печатаю...');
  // У A появляется окантовка вокруг аватара чата с B.
  await expect(aItem.getByTestId('avatar-typing')).toBeVisible();

  // Отправка завершает набор — окантовка уходит (приходит message.new вместо typing).
  await pageB.getByTestId('message-send').click();
  await expect(aItem.getByTestId('avatar-typing')).toHaveCount(0);

  await ctxA.close();
  await ctxB.close();
});

test('ChatList: у группы нет кружка присутствия, но есть окантовка тайпинга', async ({
  browser,
}) => {
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const pageA = await ctxA.newPage();
  const pageB = await ctxB.newPage();

  await registerViaUi(pageA);
  const b = await registerViaUi(pageB);
  // Чтобы у A в списке знакомых был B, создадим личный чат (источник кандидатов).
  await createDirectViaUi(pageA, b.username);
  await expect(pageA.getByTestId('conversation-open')).toBeVisible();

  // A создаёт группу с B.
  await createGroupViaUi(pageA, 'Команда', [b.username]);
  await expect(pageA.getByTestId('conversation-open')).toBeVisible();

  // B открывает группу.
  await pageB.getByTestId('chat-item').filter({ hasText: 'Команда' }).click();
  await expect(pageB.getByTestId('conversation-open')).toBeVisible();

  const groupItem = pageA
    .getByTestId('chat-item')
    .filter({ hasText: 'Команда' });
  // У группы кружок присутствия не показываем.
  await expect(groupItem.getByTestId('avatar-status')).toHaveCount(0);

  // B печатает в группу → у A окантовка на аватаре группы.
  await pageB.getByTestId('message-input').fill('всем привет');
  await expect(groupItem.getByTestId('avatar-typing')).toBeVisible();

  await ctxA.close();
  await ctxB.close();
});
