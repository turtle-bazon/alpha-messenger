import { expect, test } from '@playwright/test';
import { registerViaUi } from './helpers/ui';

// Известная проблема №8: при reconnect/reload реплей outbox не должен
// обрабатываться как live (уведомления/звуки/бейджи). Курсор потока (lastSeq)
// сохраняется между сессиями — сервер реплеит только пропущенное, а историю
// клиент не выдаёт за происходящее сейчас.
test('после reload история не всплывает как live-уведомление; lastSeq сохранён', async ({
  browser,
}) => {
  // Устройство A: регистрируемся, остаёмся онлайн (WS подключён).
  const ctxA = await browser.newContext();
  const pageA = await ctxA.newPage();
  const creds = await registerViaUi(pageA);

  // Вход со второго устройства → A получает live-уведомление безопасности.
  const ctxB = await browser.newContext();
  const pageB = await ctxB.newPage();
  await pageB.goto('/');
  await pageB.getByLabel('Имя пользователя').fill(creds.username);
  await pageB.getByLabel('Пароль').fill(creds.password);
  await pageB.getByRole('button', { name: 'Войти' }).click();
  await expect(pageB.getByTestId('app-home')).toBeVisible();

  await expect(pageA.getByTestId('account-notice')).toBeVisible();

  // Курсор потока сохранён в localStorage (механизм resume).
  const seq = await pageA.evaluate(() => {
    const uid = localStorage.getItem('alpha.userId');
    return Number(localStorage.getItem(`alpha.lastSeq.${uid}`) ?? '0');
  });
  expect(seq).toBeGreaterThan(0);

  // A перезагружается: сервер реплеит историю (тот самый auth.attempt уже был) —
  // но это история, не live, поэтому уведомление повторно НЕ всплывает.
  await pageA.reload();
  await expect(pageA.getByTestId('app-home')).toBeVisible();
  await pageA.waitForTimeout(1500); // даём WS подключиться и проиграть реплей
  await expect(pageA.getByTestId('account-notice')).toHaveCount(0);

  // Курсор не сбросился назад (resume продолжается с сохранённого места).
  const seqAfter = await pageA.evaluate(() => {
    const uid = localStorage.getItem('alpha.userId');
    return Number(localStorage.getItem(`alpha.lastSeq.${uid}`) ?? '0');
  });
  expect(seqAfter).toBeGreaterThanOrEqual(seq);
});
