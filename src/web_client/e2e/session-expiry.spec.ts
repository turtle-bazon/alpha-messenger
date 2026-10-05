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

  // Первый же аутентифицированный запрос получает 401 -> клиент чистит
  // сессию и перезагружается на экран входа. Перезагрузка страницы делает
  // GET /me с уже мёртвым токеном — у свежего пользователя чатов нет, поэтому
  // кликать по списку чатов здесь нечего.
  await page.reload();
  await expect(page.getByTestId('login-screen')).toBeVisible();

  // Локальный токен удалён: ещё одна перезагрузка не возвращает в приложение.
  await page.reload();
  await expect(page.getByTestId('login-screen')).toBeVisible();
});
