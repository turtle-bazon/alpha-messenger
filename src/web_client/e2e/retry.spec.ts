import { expect, test, type Page } from '@playwright/test';
import { createDirectViaUi, registerViaUi } from './helpers/ui';

// Перехват POST отправки сообщения (имитация недоступной сети). GET истории
// (с query) под шаблон не попадает — рвём только POST.
async function failSends(page: Page): Promise<void> {
  await page.route('**/chats/*/messages', (route) => {
    if (route.request().method() === 'POST') return route.abort();
    return route.continue();
  });
}

// Задача #26: неотправленное помечается failed с кнопкой «Повторить»; повтор
// досылает сообщение; более позднее сообщение не обгоняет застрявшее раннее.
test('неотправленное: failed + ручной повтор, порядок сохраняется', async ({
  browser,
}) => {
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const pageA = await ctxA.newPage();
  const pageB = await ctxB.newPage();
  const a = await registerViaUi(pageA);
  const b = await registerViaUi(pageB);
  await createDirectViaUi(pageA, b.username);

  const input = pageA.getByTestId('message-input');
  await failSends(pageA);

  // Первое — падает в failed, появляется кнопка повтора.
  await input.fill('первое');
  await input.press('Enter');
  const m1 = pageA.getByTestId('message').filter({ hasText: 'первое' });
  await expect(m1.getByTestId('msg-status')).toHaveAttribute(
    'data-status',
    'failed',
  );
  await expect(m1.getByTestId('msg-retry')).toBeVisible();

  // Второе — встаёт в очередь за застрявшим первым: «sending», не обгоняет.
  await input.fill('второе');
  await input.press('Enter');
  const m2 = pageA.getByTestId('message').filter({ hasText: 'второе' });
  await expect(m2.getByTestId('msg-status')).toHaveAttribute(
    'data-status',
    'sending',
  );
  await expect(m1.getByTestId('msg-status')).toHaveAttribute(
    'data-status',
    'failed',
  );

  // Восстанавливаем сеть и жмём «Повторить» — оба досылаются по порядку.
  await pageA.unroute('**/chats/*/messages');
  await m1.getByTestId('msg-retry').click();
  await expect(m1.getByTestId('msg-status')).toHaveAttribute(
    'data-status',
    /sent|read/,
  );
  await expect(m2.getByTestId('msg-status')).toHaveAttribute(
    'data-status',
    /sent|read/,
  );
  await expect(m1.getByTestId('msg-retry')).toHaveCount(0);

  // У B сообщения пришли строго в порядке: «первое» раньше «второго».
  await pageB.getByTestId('chat-item').filter({ hasText: a.username }).click();
  await pageB.getByTestId('conversation-open').waitFor();
  await expect(
    pageB.getByTestId('message').filter({ hasText: 'второе' }),
  ).toBeVisible();
  const texts = await pageB.getByTestId('message').allInnerTexts();
  const idx1 = texts.findIndex((t) => t.includes('первое'));
  const idx2 = texts.findIndex((t) => t.includes('второе'));
  expect(idx1).toBeGreaterThanOrEqual(0);
  expect(idx1).toBeLessThan(idx2);

  await ctxA.close();
  await ctxB.close();
});

// Автоповтор при восстановлении связи (событие online).
test('неотправленное: автоповтор по событию online', async ({ browser }) => {
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const pageA = await ctxA.newPage();
  const pageB = await ctxB.newPage();
  const b = await registerViaUi(pageB);
  await registerViaUi(pageA);
  await createDirectViaUi(pageA, b.username);

  const input = pageA.getByTestId('message-input');
  await failSends(pageA);
  await input.fill('авто');
  await input.press('Enter');
  const m = pageA.getByTestId('message').filter({ hasText: 'авто' });
  await expect(m.getByTestId('msg-status')).toHaveAttribute(
    'data-status',
    'failed',
  );

  // Сеть вернулась — эмулируем событие online, ожидаем автодосылку без клика.
  await pageA.unroute('**/chats/*/messages');
  await pageA.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(m.getByTestId('msg-status')).toHaveAttribute(
    'data-status',
    /sent|read/,
  );

  await ctxA.close();
  await ctxB.close();
});
