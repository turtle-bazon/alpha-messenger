import { expect, test } from '@playwright/test';
import { createDirectViaUi, registerViaUi } from './helpers/ui';

// Задачи #19 (стабильная кнопка отправки), #25 (авторасширение поля, Enter /
// Shift+Enter) и #24 (SVG-галочки статуса).
test('композер: кнопка всегда видна, Enter/Shift+Enter, авторасширение, SVG-статус', async ({
  browser,
}) => {
  const ctxA = await browser.newContext({ locale: 'ru-RU' });
  const ctxB = await browser.newContext({ locale: 'ru-RU' });
  const pageA = await ctxA.newPage();
  const pageB = await ctxB.newPage();
  await registerViaUi(pageA);
  const b = await registerViaUi(pageB);
  await createDirectViaUi(pageA, b.username);

  const input = pageA.getByTestId('message-input');
  const send = pageA.getByTestId('message-send');

  // #34: при пустом поле на месте кнопки отправки показывается микрофон
  // (как в Telegram) — отдельной «выключенной» кнопки отправки больше нет.
  const mic = pageA.getByTestId('mic-btn');
  await expect(mic).toBeVisible();
  await expect(send).toHaveCount(0);
  await input.fill('привет');
  await expect(send).toBeVisible();
  await expect(mic).toHaveCount(0);

  // #25: Enter отправляет; поле очищается, микрофон возвращается.
  await input.press('Enter');
  await expect(
    pageA.getByTestId('message').filter({ hasText: 'привет' }),
  ).toBeVisible();
  await expect(input).toHaveText('');
  await expect(mic).toBeVisible();

  // #24: у отправленного (ещё не прочитанного) — статус «sent» c SVG-галочкой.
  const status = pageA
    .getByTestId('message')
    .filter({ hasText: 'привет' })
    .getByTestId('msg-status');
  await expect(status).toHaveAttribute('data-status', 'sent');
  await expect(status.locator('svg')).toBeVisible();

  // #25: высота поля в одну строку — эталон для сравнения роста.
  await input.fill('одна строка');
  const h1 = await input.evaluate((el) => (el as HTMLElement).clientHeight);

  // Shift+Enter вставляет перенос строки и НЕ отправляет.
  await input.fill('строка');
  await input.press('Shift+Enter');
  await input.pressSequentially('вторая');
  await expect(input).toHaveText('строка\nвторая');
  // Поле выросло по высоте (минимум на одну строку).
  const h2 = await input.evaluate((el) => (el as HTMLElement).clientHeight);
  expect(h2).toBeGreaterThan(h1);
  // Сообщение с переносом ещё не отправлено.
  await expect(
    pageA.getByTestId('message').filter({ hasText: 'вторая' }),
  ).toHaveCount(0);

  // Enter отправляет многострочное; поле сжимается обратно.
  await input.press('Enter');
  await expect(
    pageA.getByTestId('message').filter({ hasText: 'вторая' }),
  ).toBeVisible();
  const h3 = await input.evaluate((el) => (el as HTMLElement).clientHeight);
  expect(h3).toBe(h1);

  await ctxA.close();
  await ctxB.close();
});
