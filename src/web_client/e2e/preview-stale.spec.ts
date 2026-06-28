import { expect, test } from '@playwright/test';
import { registerViaUi, createDirectViaUi } from './helpers/ui';

// Регрессия #28: превью последнего сообщения в ChatList должно отражать самое
// свежее сообщение при инкрементальном обновлении через WS (без перезагрузки).
test('превью в ChatList обновляется при новом сообщении', async ({ browser }) => {
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

  // A → B: «привет-один». Превью у получателя и у отправителя — «привет-один».
  await pageA.getByTestId('message-input').fill('привет-один');
  await pageA.getByTestId('message-send').click();
  await expect(pageB.getByTestId('messages')).toContainText('привет-один');

  const bItem = pageB.getByTestId('chat-item').filter({ hasText: a.username });
  await expect(bItem.getByTestId('chat-item-preview')).toHaveText('привет-один');
  const aItem = pageA.getByTestId('chat-item').filter({ hasText: b.username });
  await expect(aItem.getByTestId('chat-item-preview')).toHaveText('привет-один');

  // A → B: «привет-два». Превью обновляется у обоих.
  await pageA.getByTestId('message-input').fill('привет-два');
  await pageA.getByTestId('message-send').click();
  await expect(pageB.getByTestId('messages')).toContainText('привет-два');
  await expect(bItem.getByTestId('chat-item-preview')).toHaveText('привет-два');
  await expect(aItem.getByTestId('chat-item-preview')).toHaveText('привет-два');

  await ctxA.close();
  await ctxB.close();
});

// Регрессия #28 (гонка getChat): во вновь появившийся у получателя чат сразу
// прилетает несколько сообщений. Превью должно показать ПОСЛЕДНЕЕ, а не застрять
// на раннем из-за параллельных getChat по каждому message.new.
test('превью нового чата отражает последнее из всплеска сообщений', async ({
  browser,
}) => {
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const pageA = await ctxA.newPage();
  const pageB = await ctxB.newPage();

  const a = await registerViaUi(pageA);
  const b = await registerViaUi(pageB);
  // A остаётся на главном экране (чата с B ещё нет в списке).
  await expect(pageA.getByTestId('app-home')).toBeVisible();

  // B создаёт чат с A и сразу шлёт серию, не дожидаясь подтверждений.
  await createDirectViaUi(pageB, a.username);
  await expect(pageB.getByTestId('conversation-open')).toBeVisible();
  for (const t of ['всплеск-1', 'всплеск-2', 'всплеск-3']) {
    await pageB.getByTestId('message-input').fill(t);
    await pageB.getByTestId('message-send').click();
  }
  await expect(pageB.getByTestId('messages')).toContainText('всплеск-3');

  // У A появляется чат, превью — последнее сообщение серии.
  const aItem = pageA.getByTestId('chat-item').filter({ hasText: b.username });
  await expect(aItem).toBeVisible();
  await expect(aItem.getByTestId('chat-item-preview')).toHaveText('всплеск-3');

  await ctxA.close();
  await ctxB.close();
});
