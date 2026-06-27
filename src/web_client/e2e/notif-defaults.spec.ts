import { expect, test } from '@playwright/test';
import { registerViaUi } from './helpers/ui';

// Задачи #29 и #30: дефолты уведомлений должны явно фиксироваться в localStorage
// при входе. Дефолт browser ВСЕГДА '1' — независимо от Notification.permission
// (#30: 'denied' возникает и когда API недоступен, не только при реальной
// блокировке). При denied тумблер показывается включённым, но заблокированным
// (как в Telegram), без рассинхрона хранилища и UI.

const SOUND_KEY = 'alpha.notif.sound';
const BROWSER_KEY = 'alpha.notif.browser';

// Разрешение ещё не запрашивалось (Notification.permission === 'default'):
// при первом входе показывается баннер, запрос разрешения — по клику (user gesture).
test('при default permission показывается баннер и запрашивается разрешение по клику', async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(Notification, 'permission', {
      configurable: true,
      get: () => 'default',
    });
    // Перехватываем requestPermission чтобы проверить вызов
    (Notification as any).__requestPermissionCalled = false;
    Notification.requestPermission = async () => {
      (Notification as any).__requestPermissionCalled = true;
      return 'granted';
    };
  });
  await registerViaUi(page);

  // Баннер виден при первом входе (ключей нет, permission = default)
  const banner = page.getByTestId('notif-banner');
  await expect(banner).toBeVisible();

  // Дефолты уже сидят: звук '1', browser '1'
  const sound = await page.evaluate((k) => localStorage.getItem(k), SOUND_KEY);
  const browser = await page.evaluate(
    (k) => localStorage.getItem(k),
    BROWSER_KEY,
  );
  expect(sound).toBe('1');
  expect(browser).toBe('1');

  // Тумблер показывает включён (prefs.browser = true,perm = default)
  await page.getByTestId('notif-toggle').click();
  await expect(page.getByTestId('notif-browser')).toBeChecked();

  // Клик «Разрешить» — вызывается requestPermission (user gesture)
  await page.getByTestId('notif-banner-allow').click();
  await expect(banner).not.toBeVisible();

  const wasCalled = await page.evaluate(
    () => (Notification as any).__requestPermissionCalled,
  );
  expect(wasCalled).toBe(true);

  // После granted — browser остаётся '1'
  const browserAfter = await page.evaluate(
    (k) => localStorage.getItem(k),
    BROWSER_KEY,
  );
  expect(browserAfter).toBe('1');
});

// Разрешение ещё не запрашивалось, но пользователь нажал «Нет»:
// баннер скрывается, browser фиксируется в '0'.
test('при default permission нажатие «Нет» отключает браузерные уведомления', async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(Notification, 'permission', {
      configurable: true,
      get: () => 'default',
    });
  });
  await registerViaUi(page);

  const banner = page.getByTestId('notif-banner');
  await expect(banner).toBeVisible();

  await page.getByTestId('notif-banner-skip').click();
  await expect(banner).not.toBeVisible();

  const browser = await page.evaluate(
    (k) => localStorage.getItem(k),
    BROWSER_KEY,
  );
  expect(browser).toBe('0');
});

// Разрешение выдано (granted): после входа в localStorage появляются оба ключа
// со значением '1'. (headless Chromium статически отдаёт permission='denied'
// независимо от grantPermissions, поэтому granted эмулируем через init-скрипт.)
test('дефолты уведомлений сидятся в localStorage при входе', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(Notification, 'permission', {
      configurable: true,
      get: () => 'granted',
    });
  });
  await registerViaUi(page);

  const sound = await page.evaluate((k) => localStorage.getItem(k), SOUND_KEY);
  const browser = await page.evaluate(
    (k) => localStorage.getItem(k),
    BROWSER_KEY,
  );
  expect(sound).toBe('1');
  expect(browser).toBe('1');
});

// Разрешение заблокировано/недоступно (Notification.permission === 'denied'):
// browser-ключ всё равно дефолтится в '1' (#30), а в меню тумблер показан
// включённым, но заблокированным, с подсказкой; звук тоже включён ('1').
test('при denied браузерные уведомления остаются включёнными, но заблокированными', async ({
  page,
}) => {
  // Эмулируем заблокированное разрешение до загрузки приложения.
  await page.addInitScript(() => {
    Object.defineProperty(Notification, 'permission', {
      configurable: true,
      get: () => 'denied',
    });
  });
  await registerViaUi(page);

  const sound = await page.evaluate((k) => localStorage.getItem(k), SOUND_KEY);
  const browser = await page.evaluate(
    (k) => localStorage.getItem(k),
    BROWSER_KEY,
  );
  expect(sound).toBe('1');
  expect(browser).toBe('1');

  // В меню: звук включён, браузерные — включены, но недоступны, есть подсказка.
  await page.getByTestId('notif-toggle').click();
  await expect(page.getByTestId('notif-sound')).toBeChecked();
  await expect(page.getByTestId('notif-browser')).toBeChecked();
  await expect(page.getByTestId('notif-browser')).toBeDisabled();
  await expect(page.getByTestId('notif-denied')).toBeVisible();
});
