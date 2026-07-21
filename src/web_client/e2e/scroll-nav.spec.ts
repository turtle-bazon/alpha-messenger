import { expect, test, type Page } from '@playwright/test';
import { createDirectViaUi, registerViaUi } from './helpers/ui';

// Прокручивает .conv-scroll вверх на указанное количество пикселей.
async function scrollUp(page: Page, px: number): Promise<void> {
  await page.evaluate((delta) => {
    const el = document.querySelector('.conv-scroll');
    if (el) el.scrollTop -= delta;
  }, px);
}

// ==================== #53 — Кнопка «назад» после перехода к сообщению ====================

test('#53: кнопка «назад» после перехода по ответу', async ({ browser }) => {
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

  // A отправляет три сообщения
  for (const text of ['сообщение 1', 'сообщение 2', 'сообщение 3']) {
    await pageA.getByTestId('message-input').fill(text);
    await pageA.getByTestId('message-send').click();
    await expect(pageA.getByTestId('messages')).toContainText(text);
  }
  // Ждём, пока все три дойдут до B
  await expect(pageB.getByTestId('messages')).toContainText('сообщение 3');

  // A отвечает на «сообщение 1» текстом «ответ на 1»
  const msg1 = pageA.getByTestId('message').filter({ hasText: 'сообщение 1' });
  await msg1.hover();
  await msg1.getByTestId('msg-reply').click();
  await pageA.getByTestId('message-input').fill('ответ на 1');
  await pageA.getByTestId('message-send').click();
  await expect(pageB.getByTestId('messages')).toContainText('ответ на 1');

  // B: кликает по превью ответа (bubble-reply) в «ответ на 1»
  const replyOnB = pageB
    .getByTestId('message')
    .filter({ hasText: 'ответ на 1' })
    .locator('.bubble-reply');
  await replyOnB.click();

  // Должна появиться кнопка «назад»
  const backBtn = pageB.getByTestId('nav-back');
  await expect(backBtn).toBeVisible();

  // Кликаем «назад» — кнопка исчезает
  await backBtn.click();
  await expect(backBtn).toHaveCount(0);
});

// ==================== #76 — Кнопка «к последнему сообщению» ====================

test('#76: кнопка «к последнему» при пролистывании вверх', async ({
  browser,
}) => {
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const pageA = await ctxA.newPage();
  const pageB = await ctxB.newPage();

  const a = await registerViaUi(pageA);
  const b = await registerViaUi(pageB);

  // Чат A↔B
  await createDirectViaUi(pageA, b.username);
  await expect(pageA.getByTestId('conversation-open')).toBeVisible();
  await pageB.getByTestId('chat-item').filter({ hasText: a.username }).click();
  await expect(pageB.getByTestId('conversation-open')).toBeVisible();

  // A отправляет 30 сообщений, чтобы создать прокрутку
  for (let i = 1; i <= 30; i++) {
    await pageA.getByTestId('message-input').fill(`message ${i}`);
    await pageA.getByTestId('message-send').click();
  }
  await expect(pageB.getByTestId('messages')).toContainText('message 30');

  // B внизу — кнопки «вниз» нет
  await expect(pageB.getByTestId('scroll-to-bottom')).toHaveCount(0);

  // B прокручивает вверх
  await scrollUp(pageB, 2000);
  // Дожидаемся появления кнопки (с debounce 150ms)
  const scrollBtn = pageB.getByTestId('scroll-to-bottom');
  await expect(scrollBtn).toBeVisible();

  // A отправляет новое сообщение, пока B вверху → появляется бейдж
  await pageA.getByTestId('message-input').fill('новое сообщение');
  await pageA.getByTestId('message-send').click();
  await expect(pageB.getByTestId('messages')).toContainText('новое сообщение');
  const badge = scrollBtn.locator('.scroll-to-bottom-badge');
  await expect(badge).toBeVisible();

  // B кликает «к последнему» — скролл вниз, кнопка исчезает
  await scrollBtn.click();
  await expect(scrollBtn).toHaveCount(0);

  await ctxA.close();
  await ctxB.close();
});
