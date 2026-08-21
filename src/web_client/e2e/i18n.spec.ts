import { expect, test } from '@playwright/test';
import { registerViaUi } from './helpers/ui';

// #58 i18n: автоопределение языка браузера, переключение в настройках,
// сохранение выбора в localStorage.

// Первый запуск без сохранённого выбора: язык берётся из локали браузера.
test('язык определяется по локали браузера (en-US -> английский)', async ({
  browser,
}) => {
  const ctx = await browser.newContext({ locale: 'en-US' });
  const page = await ctx.newPage();
  await page.goto('/login');
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  await expect(page.getByLabel('Username')).toBeVisible();
});

// Переключение языка в настройках применяется сразу и переживает перезагрузку.
test('переключение языка в настройках и сохранение выбора', async ({
  browser,
}) => {
  const ctx = await browser.newContext({ locale: 'ru-RU' });
  const page = await ctx.newPage();
  await registerViaUi(page);

  // Настройки -> Язык -> English
  await page.getByTestId('settings-btn').click();
  await expect(page.getByTestId('settings-screen')).toBeVisible();
  await page.getByTestId('settings-language').selectOption('en');
  await expect(
    page.getByTestId('settings-screen').locator('.settings-header-title'),
  ).toHaveText('Settings');
  await expect(page.getByTestId('settings-logout')).toHaveText('Log out');

  // Выбор сохранён в localStorage: после перезагрузки — снова английский
  await page.reload();
  await expect(page.getByTestId('app-home')).toBeVisible();
  await page.getByTestId('settings-btn').click();
  await expect(
    page.getByTestId('settings-screen').locator('.settings-header-title'),
  ).toHaveText('Settings');
  await expect(page.getByTestId('settings-language')).toHaveValue('en');

  // Обратно на русский
  await page.getByTestId('settings-language').selectOption('ru');
  await expect(
    page.getByTestId('settings-screen').locator('.settings-header-title'),
  ).toHaveText('Настройки');
});
