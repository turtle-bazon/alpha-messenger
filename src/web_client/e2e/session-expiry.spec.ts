import { expect, test } from '@playwright/test';
import { deleteSessions } from './helpers/db';
import { registerViaUi } from './helpers/ui';

// #88: потеря сессии на сервере (обновление/сброс БД) не должна оставлять
// «зомби»-интерфейс, где оболочка есть, а все запросы молча падают.
// Первый же 401 вне /auth/* должен разлогинить: очистить сессию и показать
// экран входа.
test('потеря сессии на сервере разлогинивает автоматически', async ({
  page,
}) => {
  const { username } = await registerViaUi(page);
  await expect(page.getByTestId('app-home')).toBeVisible();

  // Сервер «потерял» сессии пользователя.
  await deleteSessions(username);

  // Любой аутентифицированный запрос (открытие чата) получает 401 ->
  // клиент очищает сессию и перезагружается на экран входа.
  await page.getByTestId('chat-item').first().click();
  await expect(page.getByTestId('login-screen')).toBeVisible();

  // Локальный токен удалён: после перезагрузки пользователь остаётся
  // на входе, а не возвращается в «пустое» приложение.
  await page.reload();
  await expect(page.getByTestId('login-screen')).toBeVisible();
});
