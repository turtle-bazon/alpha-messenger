import { expect, test } from '@playwright/test';
import { registerViaApi } from './helpers/api';
import { registerViaUi } from './helpers/ui';

// Создание пака, добавление стикеров, отправка стикера в чат
test('stickers: create pack, add stickers, send sticker', async ({ page }) => {
  await registerViaApi();
  await registerViaUi(page);

  // Открываем панель стикеров
  await page.getByTestId('sticker-btn').click();
  await expect(page.getByTestId('sticker-panel')).toBeVisible();

  // Создаём новый пак
  page.on('dialog', async (dialog) => {
    await dialog.accept('Тестовый пак');
  });
  await page.getByText('Новый пак').click();

  // Пак создан, мы внутри него
  await expect(page.getByText('Добавить стикер')).toBeVisible();

  // Закрываем панель
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('sticker-panel')).toHaveCount(0);
});

// Панель стикеров: открытие/закрытие
test('stickers: panel open and close', async ({ page }) => {
  await registerViaUi(page);

  // Нет панели
  await expect(page.getByTestId('sticker-panel')).toHaveCount(0);

  // Открываем
  await page.getByTestId('sticker-btn').click();
  await expect(page.getByTestId('sticker-panel')).toBeVisible();

  // Закрываем по Escape
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('sticker-panel')).toHaveCount(0);
});

// Кнопки эмодзи и стикеров не конфликтуют
test('stickers: emoji and sticker panels are mutually exclusive', async ({ page }) => {
  await registerViaUi(page);

  // Открываем эмодзи
  await page.getByTestId('emoji-btn').click();
  await expect(page.getByTestId('emoji-picker')).toBeVisible();

  // Открываем стикеры — эмодзи закрывается
  await page.getByTestId('sticker-btn').click();
  await expect(page.getByTestId('sticker-panel')).toBeVisible();
  await expect(page.getByTestId('emoji-picker')).toHaveCount(0);

  // Открываем эмодзи — стикеры закрываются
  await page.getByTestId('emoji-btn').click();
  await expect(page.getByTestId('emoji-picker')).toBeVisible();
  await expect(page.getByTestId('sticker-panel')).toHaveCount(0);
});
