import { expect, test } from '@playwright/test';
import { createDirectViaUi, registerViaUi } from './helpers/ui';

// Уведомления о новых сообщениях (известная проблема №8): счётчик непрочитанных
// в title вкладки + браузерное уведомление, когда вкладка не активна.
test('непрочитанное сообщение даёт badge в title и браузерное уведомление', async ({
  browser,
}) => {
  const ctxA = await browser.newContext();
  // Эмулируем «вкладка не активна» и подменяем Notification, чтобы перехватить
  // показанные уведомления (реальный системный попап в headless недоступен).
  await ctxA.addInitScript(() => {
    (window as unknown as { __notifs: unknown[] }).__notifs = [];
    class FakeNotification {
      static permission = 'granted';
      static requestPermission = async (): Promise<string> => 'granted';
      onclick: (() => void) | null = null;
      constructor(title: string, opts?: { body?: string }) {
        (window as unknown as { __notifs: unknown[] }).__notifs.push({
          title,
          body: opts?.body,
        });
      }
      close(): void {}
    }
    (window as unknown as { Notification: unknown }).Notification =
      FakeNotification;
    Object.defineProperty(document, 'hidden', {
      configurable: true,
      get: () => true,
    });
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'hidden',
    });
    document.hasFocus = () => false;
  });
  const ctxB = await browser.newContext();
  const pageA = await ctxA.newPage();
  const pageB = await ctxB.newPage();

  const a = await registerViaUi(pageA);
  const b = await registerViaUi(pageB);

  // B создаёт чат к A и пишет первым. A чат НЕ открывает — значит сообщение
  // непрочитано: растёт badge в списке и счётчик в title.
  await createDirectViaUi(pageB, a.username);
  await expect(pageB.getByTestId('conversation-open')).toBeVisible();

  const aItem = pageA.getByTestId('chat-item').filter({ hasText: b.username });
  await expect(aItem).toBeVisible();

  await pageB.getByTestId('message-input').fill('пинг для уведомления');
  await pageB.getByTestId('message-send').click();

  // Badge непрочитанных в списке у A.
  await expect(aItem.getByTestId('chat-unread')).toHaveText('1');
  // Счётчик в title вкладки.
  await expect(pageA).toHaveTitle(/^\(1\)/);
  // Браузерное уведомление с текстом сообщения (вкладка не активна → показано).
  await expect
    .poll(async () =>
      pageA.evaluate(
        () => (window as unknown as { __notifs: { body?: string }[] }).__notifs,
      ),
    )
    .toContainEqual(
      expect.objectContaining({ body: 'пинг для уведомления' }),
    );

  // Открываем чат у A — непрочитанное сбрасывается, title чистый.
  await aItem.click();
  await expect(pageA.getByTestId('conversation-open')).toBeVisible();
  await expect(aItem.getByTestId('chat-unread')).toHaveCount(0);
  await expect(pageA).not.toHaveTitle(/^\(/);

  await ctxA.close();
  await ctxB.close();
});

// Настройки уведомлений: тумблеры звука/браузера сохраняются между сессиями.
test('настройки уведомлений переключаются и сохраняются', async ({ page }) => {
  await registerViaUi(page);

  // По умолчанию всё включено: меню показывает оба чекбокса отмеченными.
  await page.getByTestId('notif-toggle').click();
  await expect(page.getByTestId('notif-menu')).toBeVisible();
  await expect(page.getByTestId('notif-sound')).toBeChecked();

  // Выключаем звук — пишется в localStorage.
  await page.getByTestId('notif-sound').uncheck();
  await expect
    .poll(() =>
      page.evaluate(() => localStorage.getItem('alpha.notif.sound')),
    )
    .toBe('0');

  // Клик вне меню закрывает его.
  await page.getByTestId('home-username').click();
  await expect(page.getByTestId('notif-menu')).toHaveCount(0);

  // После перезагрузки настройка сохранилась.
  await page.reload();
  await expect(page.getByTestId('app-home')).toBeVisible();
  await page.getByTestId('notif-toggle').click();
  await expect(page.getByTestId('notif-sound')).not.toBeChecked();

  await page.close();
});
