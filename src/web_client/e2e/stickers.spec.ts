import { expect, test } from '@playwright/test';
import { registerViaApi } from './helpers/api';
import { registerViaUi } from './helpers/ui';

// Создание пака, добавление стикеров
test('stickers: create pack and add stickers', async ({ page }) => {
  await registerViaApi();
  await registerViaUi(page);

  // Открываем панель через одну кнопку
  await page.getByTestId('emoji-btn').click();
  await expect(page.getByTestId('media-panel')).toBeVisible();

  // Переключаемся на вкладку стикеров
  await page.getByText('Стикеры', { exact: true }).click();

  // Создаём новый пак
  page.on('dialog', async (dialog) => {
    await dialog.accept('Тестовый пак');
  });
  await page.getByText('Новый пак').click();

  // Пак создан, мы внутри него
  await expect(page.getByText('Добавить стикер')).toBeVisible();

  // Закрываем панель
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('media-panel')).toHaveCount(0);
});

// Панель: открытие/закрытие
test('media panel: open and close', async ({ page }) => {
  await registerViaUi(page);

  await expect(page.getByTestId('media-panel')).toHaveCount(0);

  await page.getByTestId('emoji-btn').click();
  await expect(page.getByTestId('media-panel')).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(page.getByTestId('media-panel')).toHaveCount(0);
});

// Вкладки переключаются
test('media panel: tabs switch', async ({ page }) => {
  await registerViaUi(page);

  await page.getByTestId('emoji-btn').click();
  await expect(page.getByTestId('media-panel')).toBeVisible();

  // По умолчанию эмодзи
  await expect(page.getByTestId('emoji-picker')).toBeVisible();

  // Стикеры
  await page.getByText('Стикеры', { exact: true }).click();

  // GIF
  await page.getByText('GIF', { exact: true }).click();
});
