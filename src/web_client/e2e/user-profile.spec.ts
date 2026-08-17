import { expect, test } from '@playwright/test';
import { registerViaApi } from './helpers/api';
import { createDirectViaUi, registerViaUi } from './helpers/ui';

// Проверка профиля пользователя: открытие по клику на аватар в шапке direct-чата,
// просмотр информации и заметок.
test('профиль пользователя: открытие, просмотр, заметка', async ({
  page,
}) => {
  const b = await registerViaApi();
  await registerViaUi(page);

  // Создаём direct-чат с пользователем B
  await createDirectViaUi(page, b.username);
  await expect(page.getByTestId('conversation-open')).toBeVisible();

  // Кликаем на заголовок чата (с аватаром собеседника), чтобы открыть профиль
  await page.getByTestId('conv-header-info').click();

  // Проверяем что диалог профиля открылся
  await expect(page.getByTestId('user-profile-dialog')).toBeVisible();
  await expect(page.getByTestId('profile-close')).toBeVisible();

  // Проверяем что username отображается
  await expect(page.locator('.profile-username')).toHaveText(b.username);

  // Проверяем что секция заметки видна (не для своего профиля)
  await expect(page.getByTestId('profile-note-input')).toBeVisible();

  // Вводим заметку
  await page.getByTestId('profile-note-input').fill('Тестовая заметка');

  // Ждём автосохранения (1с дебаунс)
  await page.waitForTimeout(1500);

  // Закрываем диалог
  await page.getByTestId('profile-close').click();
  await expect(page.getByTestId('user-profile-dialog')).toHaveCount(0);

  // Повторно открываем профиль и проверяем что заметка сохранилась
  await page.getByTestId('conv-header-info').click();
  await expect(page.getByTestId('user-profile-dialog')).toBeVisible();
  await expect(page.getByTestId('profile-note-input')).toHaveValue(
    'Тестовая заметка',
  );
});
