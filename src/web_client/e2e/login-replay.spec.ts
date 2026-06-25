import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { registerViaApi } from './helpers/api';
import { registerViaUi, createDirectViaUi } from './helpers/ui';

const API = 'http://localhost:3000';

function envelope(text: string): string {
  const json = JSON.stringify({ t: 'text', text });
  return Buffer.from(json, 'utf8').toString('base64');
}

// Баг known_issues №4: на логине список чатов «перечитывался» — реплей outbox
// дёргал getChat на каждый чат и перерисовывал список многократно. Фикс:
// состояние берём из getChats, реплей применяется поверх (WsClient буферизует
// его в один пакет), точечный getChat на реплее не вызывается.
test('повторный логин: реплей не дёргает getChat на каждый чат', async ({
  page,
}) => {
  const b = await registerViaApi();
  const creds = await registerViaUi(page);
  await createDirectViaUi(page, b.username);

  // A отправляет сообщение, B отвечает через REST — в outbox копится история,
  // которую сервер реплеит при следующем hello с lastSeq=0.
  await page.getByTestId('chat-item').first().click();
  await page.getByTestId('message-input').fill('Привет от A');
  await page.getByTestId('message-send').click();
  await expect(page.getByTestId('message')).toContainText('Привет от A');

  const chatsRes = await fetch(`${API}/api/chats`, {
    headers: { authorization: `Bearer ${b.token}` },
  });
  const body = (await chatsRes.json()) as { chats: Array<{ chatId: string }> };
  const chatId = body.chats[0].chatId;
  await fetch(`${API}/api/chats/${chatId}/messages`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${b.token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      clientMessageId: randomUUID(),
      ciphertext: envelope('Ответ от B'),
    }),
  });
  await expect(
    page.getByTestId('messages').getByText('Ответ от B'),
  ).toBeVisible();

  // Выход: clearSession стирает lastSeq → следующий вход реплеит всё с нуля.
  await page.getByRole('button', { name: 'Выйти' }).click();
  await expect(page.getByTestId('login-screen')).toBeVisible();

  // Считаем точечные GET /api/chats/{uuid} (getChat) и список GET /api/chats.
  let getChatCalls = 0;
  let getChatsCalls = 0;
  const single = /^\/api\/chats\/[0-9a-f-]{36}$/;
  page.on('request', (req) => {
    if (req.method() !== 'GET') return;
    const path = new URL(req.url()).pathname;
    if (single.test(path)) getChatCalls += 1;
    else if (path === '/api/chats') getChatsCalls += 1;
  });

  // Повторный вход теми же кредами (свежая сессия, lastSeq=0 → полный реплей).
  await page.getByLabel('Имя пользователя').fill(creds.username);
  await page.getByLabel('Пароль').fill(creds.password);
  await page.getByRole('button', { name: 'Войти' }).click();
  await expect(page.getByTestId('app-home')).toBeVisible();

  // Список восстановлен из getChats с правильным превью последнего сообщения.
  const item = page.getByTestId('chat-item');
  await expect(item).toHaveCount(1);
  await expect(item.first()).toContainText(b.username);
  await expect(item.first()).toContainText('Ответ от B');

  // Дать реплею прийти и примениться, затем проверить отсутствие getChat.
  await page.waitForTimeout(800);
  expect(getChatsCalls).toBeGreaterThanOrEqual(1);
  expect(getChatCalls).toBe(0);
});
