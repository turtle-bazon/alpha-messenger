import { expect, test, type Page } from '@playwright/test';
import { registerViaApi } from './helpers/api';
import { createDirectViaUi, registerViaUi } from './helpers/ui';

// Свёртывание/восстановление окна эмулируем перезагрузкой страницы: сессия лежит
// в localStorage и переживает reload, поэтому это честный «холодный» рестарт
// клиента (WS переподключается, список чатов и статусы поднимаются заново).
async function restoreWindow(page: Page): Promise<void> {
  await page.reload();
  await expect(page.getByTestId('app-home')).toBeVisible();
}

// Открыть (или переоткрыть) чат с собеседником по его username.
async function openChatWith(page: Page, username: string): Promise<void> {
  await page.getByTestId('chat-item').filter({ hasText: username }).click();
  await expect(page.getByTestId('conversation-open')).toBeVisible();
}

// Статус своего сообщения с заданным текстом.
function statusOf(page: Page, text: string) {
  return page
    .getByTestId('message')
    .filter({ hasText: text })
    .getByTestId('msg-status');
}

// Полноценный сценарий двух клиентов: переписка в обе стороны, проверка статусов
// ✓/✓✓ и непрочитанных, со свёртыванием/восстановлением окон у обоих.
test('два клиента: переписка, статусы и свёртывание/восстановление окон', async ({
  browser,
}) => {
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const pageA = await ctxA.newPage();
  const pageB = await ctxB.newPage();

  const a = await registerViaUi(pageA);
  const b = await registerViaUi(pageB);
  // Третий пользователь — чтобы A мог переключиться на другой чат, оставаясь онлайн.
  const c = await registerViaApi();

  // Оба открыли общий чат.
  await createDirectViaUi(pageA, b.username);
  await expect(pageA.getByTestId('conversation-open')).toBeVisible();
  await openChatWith(pageB, a.username);

  // A → B: «раз». B видит сообщение, B (чат открыт) его читает → у A ✓✓.
  await pageA.getByTestId('message-input').fill('раз');
  await pageA.getByTestId('message-send').click();
  await expect(pageB.getByTestId('messages')).toContainText('раз');
  await expect(statusOf(pageA, 'раз')).toHaveText('✓✓');

  // A сворачивает и восстанавливает окно — статус ✓✓ для «раз» должен сохраниться
  // (сид из серверного peerReadUpTo, а не только из live-события).
  await restoreWindow(pageA);
  await openChatWith(pageA, b.username);
  await expect(statusOf(pageA, 'раз')).toHaveText('✓✓');

  // B → A: «два». A (чат открыт после восстановления) видит и читает → у B ✓✓.
  await pageB.getByTestId('message-input').fill('два');
  await pageB.getByTestId('message-send').click();
  await expect(pageA.getByTestId('messages')).toContainText('два');
  await expect(statusOf(pageB, 'два')).toHaveText('✓✓');

  // Теперь сворачивает/восстанавливает B — у B статус «два» остаётся ✓✓,
  // и вся переписка на месте.
  await restoreWindow(pageB);
  await openChatWith(pageB, a.username);
  await expect(pageB.getByTestId('messages')).toContainText('раз');
  await expect(pageB.getByTestId('messages')).toContainText('два');
  await expect(statusOf(pageB, 'два')).toHaveText('✓✓');

  // Непрочитанные. A переключается на другой чат (с C), оставаясь онлайн, —
  // чат с B перестаёт быть открытым.
  await createDirectViaUi(pageA, c.username);
  await expect(pageA.getByTestId('conversation-open')).toBeVisible();

  // B пишет «три», пока чат с B у A не открыт → на элементе чата бейдж непрочитанного.
  await pageB.getByTestId('message-input').fill('три');
  await pageB.getByTestId('message-send').click();
  const aItem = pageA.getByTestId('chat-item').filter({ hasText: b.username });
  await expect(aItem.getByTestId('chat-unread')).toHaveText('1');

  // A сворачивает/восстанавливает окно — бейдж непрочитанного сохраняется
  // (авторитетный счётчик из GET /chats).
  await restoreWindow(pageA);
  await expect(aItem.getByTestId('chat-unread')).toHaveText('1');

  // A открывает чат — «три» видно, бейдж непрочитанного снимается.
  await openChatWith(pageA, b.username);
  await expect(pageA.getByTestId('messages')).toContainText('три');
  await expect(aItem.getByTestId('chat-unread')).toHaveCount(0);

  await ctxA.close();
  await ctxB.close();
});
