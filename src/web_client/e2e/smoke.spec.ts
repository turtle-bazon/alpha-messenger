import { expect, test } from '@playwright/test';

test('приложение открывается', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('app-shell')).toBeVisible();
  // По умолчанию (без сессии) показывается экран входа.
  await expect(page.getByTestId('login-screen')).toBeVisible();
});
