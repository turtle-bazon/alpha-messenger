import { expect, test } from '@playwright/test';
import { registerViaApi } from './helpers/api';
import { registerViaUi, createDirectViaUi } from './helpers/ui';

// Сценарий на интерактивные элементы визуальной полировки (known_issues №3):
// переключатель темы через экран настроек, поиск по списку чатов, активация
// кнопки отправки и разделитель дат в переписке.
test('переключатель темы, поиск чатов, кнопка отправки и разделитель дат', async ({
  page,
}) => {
  const b = await registerViaApi();
  const c = await registerViaApi();
  await registerViaUi(page);

  // --- Тема: через экран настроек ---
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.getByTestId('settings-btn').click();
  await expect(page.getByTestId('settings-screen')).toBeVisible();
  await page.getByTestId('settings-theme').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.getByTestId('settings-theme').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  // Вернуться к списку чатов
  await page.getByTestId('settings-back').click();
  await expect(page.getByTestId('settings-screen')).not.toBeVisible();

  // --- Два чата для проверки поиска ---
  await createDirectViaUi(page, b.username);
  await createDirectViaUi(page, c.username);
  const items = page.getByTestId('chat-item');
  await expect(items).toHaveCount(2);

  // Поиск фильтрует список по имени; очистка возвращает оба чата.
  await page.getByTestId('chat-search').fill(b.username);
  await expect(items).toHaveCount(1);
  await expect(items.first()).toContainText(b.username);
  await page.getByTestId('chat-search').fill('заведомо_нет_такого');
  await expect(items).toHaveCount(0);
  await expect(page.getByTestId('chat-list')).toContainText('Ничего не найдено');
  await page.getByTestId('chat-search').fill('');
  await expect(items).toHaveCount(2);

  // --- Кнопка отправки: выключена без текста, включается с текстом ---
  await items.filter({ hasText: b.username }).click();
  await expect(page.getByTestId('conversation-open')).toBeVisible();
  await expect(page.getByTestId('message-send')).toBeDisabled();
  await page.getByTestId('message-input').fill('Привет');
  await expect(page.getByTestId('message-send')).toBeEnabled();

  // --- Разделитель дат: после отправки появляется «Сегодня» ---
  await page.getByTestId('message-send').click();
  await expect(page.getByTestId('message')).toContainText('Привет');
  await expect(page.getByTestId('date-divider').first()).toContainText(
    'Сегодня',
  );
});
