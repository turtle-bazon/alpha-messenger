import { expect, test } from '@playwright/test';
import { registerViaApi } from './helpers/api';
import { loginViaUi, registerViaUi } from './helpers/ui';

const API = process.env.E2E_API_URL ?? 'http://localhost:3000';

// Create channel via API helper
async function createChannelViaApi(
  token: string,
  title: string,
  channelUsername: string,
): Promise<string> {
  const res = await fetch(`${API}/api/chats`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ type: 'group', title, channelUsername, members: [] }),
  });
  const body = (await res.json()) as { chatId: string };
  return body.chatId;
}

// Channel creation via UI
test('channels: create channel via UI', async ({ page }) => {
  await registerViaApi();
  await registerViaUi(page);

  // Open new chat dialog
  await page.getByTestId('new-chat-button').click();
  await expect(page.getByTestId('new-chat-dialog')).toBeVisible();

  // There should be a "New channel" option — for now it's in the group flow
  // with channelUsername field. Close dialog.
  await page.getByTestId('new-chat-close').click();
});

// Subscribe and unsubscribe
test('channels: subscribe and unsubscribe', async ({ page }) => {
  const user = await registerViaApi();
  await registerViaUi(page);

  // Create a channel via API
  const channelName = `testch_${Date.now()}`;
  await createChannelViaApi(user.token, 'Test Channel', channelName);

  // Публичный канал попадает в список только после подписки, а найти его можно
  // по ссылке /channel/@handle/ — открываем её и жмём «Подписаться».
  await page.goto(`/channel/${channelName}/`);
  const banner = page.getByTestId('channel-subscribe-banner');
  await expect(banner).toBeVisible();
  await banner.getByRole('button', { name: 'Подписаться' }).click();

  // Теперь канал в списке.
  await expect(page.getByTestId('chat-item').filter({ hasText: 'Test Channel' })).toBeVisible();
  await page.getByTestId('chat-item').filter({ hasText: 'Test Channel' }).click();
  await expect(page.getByTestId('conversation-open')).toBeVisible();

  // Open channel info
  await page.getByTestId('conv-header-info').click();
  await expect(page.getByTestId('channel-info-dialog')).toBeVisible();

  // Should show channel info
  await expect(page.locator('.channel-info-title')).toHaveText('Test Channel');
  await expect(page.locator('.channel-info-username')).toHaveText(`@${channelName}`);

  // Close
  await page.getByTestId('channel-info-close').click();
  await expect(page.getByTestId('channel-info-dialog')).toHaveCount(0);
});

// Channel subscriber cannot post
test('channels: subscriber cannot send messages', async ({ browser }) => {
  const ctxOwner = await browser.newContext({ locale: 'ru-RU' });
  const ctxSub = await browser.newContext({ locale: 'ru-RU' });
  const pageOwner = await ctxOwner.newPage();
  const pageSub = await ctxSub.newPage();

  const owner = await registerViaApi();
  const sub = await registerViaApi();

  // В браузере заходим под теми же API-пользователями, что участвуют в сценарии
  // (иначе в списке не того подписчика и канала там нет).
  await loginViaUi(pageOwner, owner.username, owner.password);
  await loginViaUi(pageSub, sub.username, sub.password);

  // Owner creates a channel
  const channelName = `subtest_${Date.now()}`;
  const chatId = await createChannelViaApi(owner.token, 'Sub Test', channelName);

  // Sub subscribes via API (проверяем ответ: иначе падение ниже не объясняет
  // себе причину — подписчика в списке не будет).
  const subRes = await fetch(`${API}/api/chats/${chatId}/subscribe`, {
    method: 'POST',
    // Без content-type: тело пустое, а Fastify отвергает запрос с
    // application/json без тела (FST_ERR_CTP_EMPTY_JSON_BODY). Клиент
    // приложения заголовок ставит только когда тело есть.
    headers: { authorization: `Bearer ${sub.token}` },
  });
  expect(subRes.status, `subscribe failed: ${await subRes.text()}`).toBe(201);

  // Reload both
  await pageOwner.reload();
  await pageSub.reload();
  await pageOwner.waitForTimeout(500);
  await pageSub.waitForTimeout(500);

  // Owner opens channel and sends a message
  await pageOwner.getByTestId('chat-item').first().click();
  await expect(pageOwner.getByTestId('conversation-open')).toBeVisible();
  await pageOwner.getByTestId('message-input').fill('Hello from owner');
  await pageOwner.getByTestId('message-send').click();
  await expect(pageOwner.locator('.bubble-text').last()).toHaveText('Hello from owner');

  // Sub opens channel — should NOT see input (subscriber)
  await pageSub.getByTestId('chat-item').first().click();
  await expect(pageSub.getByTestId('conversation-open')).toBeVisible();
  await expect(pageSub.getByTestId('message-input')).toHaveCount(0);

  await ctxOwner.close();
  await ctxSub.close();
});

// SSR channel page
test('channels: SSR page renders by chatId', async ({ page, request }) => {
  const user = await registerViaApi();

  const chatId = await createChannelViaApi(user.token, 'SSR Channel', `ssr_${Date.now()}`);
  await request.post(`${API}/api/chats/${chatId}/messages`, {
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${user.token}`,
    },
    data: {
      clientMessageId: 'ssr-msg-1',
      ciphertext: Buffer.from(JSON.stringify({ t: 'msg', text: 'Hello SSR World' })).toString('base64'),
    },
  });

  const response = await page.goto(`${API}/channel/${chatId}/`);
  expect(response?.status()).toBe(200);
  await expect(page.locator('.channel-title')).toHaveText('SSR Channel');
  await expect(page.locator('.post-text').first()).toContainText('Hello SSR World');
});

// RSS feed
test('channels: RSS feed renders', async ({ request }) => {
  const user = await registerViaApi();

  const chatId = await createChannelViaApi(user.token, 'RSS Channel', `rss_${Date.now()}`);
  await request.post(`${API}/api/chats/${chatId}/messages`, {
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${user.token}`,
    },
    data: {
      clientMessageId: 'rss-msg-1',
      ciphertext: Buffer.from(JSON.stringify({ t: 'msg', text: 'RSS Test Post' })).toString('base64'),
    },
  });

  const response = await request.get(`${API}/channel/${chatId}/rss`);
  expect(response.status()).toBe(200);
  const body = await response.text();
  expect(body).toContain('<rss version="2.0">');
  expect(body).toContain('RSS Channel');
  expect(body).toContain('RSS Test Post');
});
