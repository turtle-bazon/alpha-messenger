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

// Браузерные попапы предлагаются «из коробки»: при первом входе само всплывает
// предложение включить уведомления (модальный диалог, не спрятано за тумблером).
// Но сам системный запрос идёт строго по клику «Разрешить» (user gesture) —
// иначе браузер молча игнорирует Notification.requestPermission().
test('при входе предлагает включить уведомления, запрос — по клику', async ({
  browser,
}) => {
  const ctx = await browser.newContext();
  // permission='default' (не дано/не запрещено), считаем вызовы requestPermission.
  await ctx.addInitScript(() => {
    (window as unknown as { __reqCount: number }).__reqCount = 0;
    class FakeNotification {
      static permission = 'default';
      static requestPermission = async (): Promise<string> => {
        (window as unknown as { __reqCount: number }).__reqCount++;
        return 'default';
      };
      constructor() {}
      close(): void {}
    }
    (window as unknown as { Notification: unknown }).Notification =
      FakeNotification;
  });
  const page = await ctx.newPage();
  await registerViaUi(page);

  // Модалка всплывает сама при первом входе (не за тумблером)...
  await expect(page.getByTestId('notif-overlay')).toBeVisible();
  // ...но до клика системный запрос не уходит (без user gesture он бесполезен).
  expect(
    await page.evaluate(
      () => (window as unknown as { __reqCount: number }).__reqCount,
    ),
  ).toBe(0);

  // Клик «Разрешить» — вот теперь запрашиваем разрешение (user gesture).
  await page.getByTestId('notif-banner-allow').click();
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as unknown as { __reqCount: number }).__reqCount,
      ),
    )
    .toBeGreaterThan(0);
  await expect(page.getByTestId('notif-overlay')).not.toBeVisible();

  await ctx.close();
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

// Известная проблема №11: меню колокольчика обрезалось слева (вылезало за
// .app-shell с overflow: hidden), текст был нечитаем. Меню должно целиком
// помещаться во вьюпорт и не обрезаться.
test('меню уведомлений не обрезается и помещается во вьюпорт', async ({
  page,
}) => {
  await registerViaUi(page);
  await page.getByTestId('notif-toggle').click();
  const menu = page.getByTestId('notif-menu');
  await expect(menu).toBeVisible();

  // Геометрия меню в пределах вьюпорта (left ≥ 0, right ≤ ширины окна).
  const box = await menu.boundingBox();
  const vw = page.viewportSize()!.width;
  expect(box).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(vw);

  // Тексты строк видны и читаемы целиком (не обрезаны клиппингом контейнера).
  await expect(menu.getByText('Звук')).toBeVisible();
  await expect(menu.getByText('Уведомления браузера')).toBeVisible();

  await page.close();
});
