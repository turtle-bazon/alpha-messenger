import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { registerViaApi } from './helpers/api';
import { registerViaUi } from './helpers/ui';

const API = process.env.E2E_API_URL ?? 'http://localhost:3000';

// Ciphertext в формате клиента: base64(UTF-8 JSON конверта text-сообщения).
function ciphertext(text: string): string {
  return Buffer.from(JSON.stringify({ t: 'text', text }), 'utf8').toString(
    'base64',
  );
}

// Создание direct-чата через серверный API (от лица peer'а к username).
async function createDirectViaApi(
  token: string,
  username: string,
): Promise<string> {
  const res = await fetch(`${API}/api/chats`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ type: 'direct', username }),
  });
  if (!res.ok) throw new Error(`createDirect failed: ${res.status}`);
  return ((await res.json()) as { chatId: string }).chatId;
}

async function sendViaApi(
  token: string,
  chatId: string,
  text: string,
): Promise<void> {
  const res = await fetch(`${API}/api/chats/${chatId}/messages`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      clientMessageId: randomUUID(),
      ciphertext: ciphertext(text),
    }),
  });
  if (!res.ok) throw new Error(`send failed: ${res.status}`);
}

// Регресс бага «сообщения задвоились после переключения чатов» (известная
// проблема): начальная загрузка перекрывалась с ленивой подгрузкой по чужому
// (унаследованному от прошлого чата) nextBefore, а слияние не дедуплицировало.
test('сообщения не задваиваются при переключении между чатами', async ({
  page,
}) => {
  const me = await registerViaUi(page);
  const big = await registerViaApi(); // peer с длинной историей (>50)
  const small = await registerViaApi(); // peer с короткой историей

  // Большой чат: 60 сообщений (hasMore=true, появляется nextBefore).
  const bigChat = await createDirectViaApi(big.token, me.username);
  for (let i = 1; i <= 60; i++) await sendViaApi(big.token, bigChat, `big-${i}`);

  // Маленький чат: 3 уникальных сообщения.
  const smallChat = await createDirectViaApi(small.token, me.username);
  for (let i = 1; i <= 3; i++)
    await sendViaApi(small.token, smallChat, `small-${i}`);

  // Перезагружаем — список чатов подтягивается из REST.
  await page.reload();
  await expect(page.getByTestId('app-home')).toBeVisible();

  const bigItem = page.getByTestId('chat-item').filter({ hasText: big.username });
  const smallItem = page
    .getByTestId('chat-item')
    .filter({ hasText: small.username });
  await expect(bigItem).toBeVisible();
  await expect(smallItem).toBeVisible();

  // Несколько раз переключаемся туда-сюда (баг воспроизводился рандомно).
  for (let round = 0; round < 4; round++) {
    await bigItem.click();
    await expect(page.getByTestId('conversation-open')).toBeVisible();
    await expect(page.getByTestId('messages')).toContainText('big-60');

    await smallItem.click();
    await expect(page.getByTestId('conversation-open')).toBeVisible();
    await expect(page.getByTestId('messages')).toContainText('small-3');

    // В маленьком чате ровно 3 сообщения — ни одно не задвоилось.
    await expect(page.getByTestId('message')).toHaveCount(3);
  }

  // В большом чате прокрутка вверх подгружает старую страницу без дублей.
  await bigItem.click();
  await expect(page.getByTestId('conversation-open')).toBeVisible();
  await expect(page.getByTestId('messages')).toContainText('big-60');
  await expect(page.getByTestId('message')).toHaveCount(50); // первая страница

  // Гонка повторного входа: два scroll-события в одном тике (рывок скролла к
  // верху). На старом коде guard `loadingMore` жил в React-state — второй
  // обработчик читал старое (false) значение, проскакивал и грузил ту же
  // страницу второй раз → весь блок задваивался. Должно остаться ровно 60.
  await page.locator('.conv-scroll').evaluate((el) => {
    el.scrollTop = 0;
    el.dispatchEvent(new Event('scroll'));
    el.scrollTop = 0;
    el.dispatchEvent(new Event('scroll'));
  });
  await expect(page.getByTestId('messages')).toContainText('big-1');
  await expect(page.getByTestId('message')).toHaveCount(60);
});
