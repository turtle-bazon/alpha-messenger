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

  // Первый же аутентифицированный запрос получает 401 -> клиент сам чистит
  // сессию и перезагружается на экран входа. Своего page.reload() здесь не
  // ставим: он столкнулся бы с перезагрузкой, которую делает приложение
  // (net::ERR_ABORTED).
  //
  // Запрос нужно инициировать: после удаления сессии приложение простаивает
  // (живой WS не переподключается, пулса активности нет), само по себе 401 не
  // придёт. Триггер — действие пользователя (попытка создать чат), но клики
  // ограничиваем по времени: приложение перезагружается прямо во время клика,
  // и без потолка Playwright провисит на клике до конца теста, не оставив
  // ассерту бюджет.
  const STEP_TIMEOUT = 4000;
  const fab = page.getByTestId('new-chat-button');
  if (await fab.count()) {
    await fab.click({ timeout: STEP_TIMEOUT }).catch(() => undefined);
    const input = page.getByTestId('new-chat-input');
    if (await input.count()) {
      await input.fill('no_such_user_xyz', { timeout: STEP_TIMEOUT }).catch(() => undefined);
      await page.getByTestId('new-chat-submit').click({ timeout: STEP_TIMEOUT }).catch(() => undefined);
    }
  }
  await expect(page.getByTestId('login-screen')).toBeVisible();

  // Локальный токен удалён: ещё одна перезагрузка не возвращает в приложение.
  await page.reload();
  await expect(page.getByTestId('login-screen')).toBeVisible();
});
