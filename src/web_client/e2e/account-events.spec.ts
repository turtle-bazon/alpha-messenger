import { expect, test } from '@playwright/test';
import { registerViaUi } from './helpers/ui';

// События уровня аккаунта в UI: вход в аккаунт с другого устройства должен
// прийти уже открытому клиенту по общему потоку событий и показаться как
// уведомление безопасности.
test('уведомление о входе с нового устройства приходит открытому клиенту', async ({
  browser,
}) => {
  // Устройство A: регистрируемся и остаёмся на главном экране (WS подключён).
  const ctxA = await browser.newContext();
  const pageA = await ctxA.newPage();
  const creds = await registerViaUi(pageA);

  // До входа со второго устройства уведомлений быть не должно (свой вход не в счёт).
  await expect(pageA.getByTestId('account-notice')).toHaveCount(0);

  // Устройство B: новый контекст = новый deviceId; входим тем же аккаунтом.
  const ctxB = await browser.newContext();
  const pageB = await ctxB.newPage();
  await pageB.goto('/');
  await pageB.getByLabel('Имя пользователя').fill(creds.username);
  await pageB.getByLabel('Пароль').fill(creds.password);
  await pageB.getByRole('button', { name: 'Войти' }).click();
  await expect(pageB.getByTestId('app-home')).toBeVisible();

  // У A всплывает уведомление о новом входе с нового устройства.
  const notice = pageA.getByTestId('account-notice');
  await expect(notice).toBeVisible();
  await expect(notice).toContainText('Новый вход');
  await expect(notice).toContainText('нового устройства');

  // B только что подключился и реплеит историю — но о собственном/прошлых входах
  // он не сигналит (свой deviceId отсекаем, прошлое — по baseline).
  await expect(pageB.getByTestId('account-notice')).toHaveCount(0);
});
