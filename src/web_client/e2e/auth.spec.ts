import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { createInvite } from './helpers/db';

test('регистрация по инвайту, выход и повторный вход', async ({ page }) => {
  const invite = await createInvite();
  const username = `u_${randomUUID().slice(0, 8)}`;
  const password = 'pw-secret-123';

  // Регистрация по инвайт-ссылке
  await page.goto(`/register?invite=${invite}`);
  await expect(page.getByTestId('register-screen')).toBeVisible();
  await page.getByLabel('Имя пользователя').fill(username);
  await page.getByLabel('Пароль').fill(password);
  await page.getByRole('button', { name: 'Создать аккаунт' }).click();

  // Попали в приложение, виден свой username
  await expect(page.getByTestId('app-home')).toBeVisible();
  await expect(page.getByTestId('home-username')).toHaveText(username);

  // Выход -> экран входа
  await page.getByRole('button', { name: 'Выйти' }).click();
  await expect(page.getByTestId('login-screen')).toBeVisible();

  // Повторный вход теми же кредами
  await page.getByLabel('Имя пользователя').fill(username);
  await page.getByLabel('Пароль').fill(password);
  await page.getByRole('button', { name: 'Войти' }).click();
  await expect(page.getByTestId('app-home')).toBeVisible();
  await expect(page.getByTestId('home-username')).toHaveText(username);
});
