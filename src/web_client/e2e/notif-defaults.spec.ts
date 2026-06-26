import { expect, test } from '@playwright/test';
import { registerViaUi } from './helpers/ui';

// Задача #29: дефолты уведомлений должны явно фиксироваться в localStorage при
// входе, а при заблокированном системном разрешении (denied) браузерные
// уведомления — принудительно выключаться, без рассинхрона хранилища и UI.

const SOUND_KEY = 'alpha.notif.sound';
const BROWSER_KEY = 'alpha.notif.browser';

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

// Разрешение заблокировано браузером (Notification.permission === 'denied'):
// browser-ключ фиксируется в '0', в меню — выключенный недоступный тумблер и
// подсказка о блокировке; звук при этом включён ('1').
test('при denied браузерные уведомления фиксируются выключенными', async ({
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
  expect(browser).toBe('0');

  // В меню: звук включён, браузерные — выключены и недоступны, есть подсказка.
  await page.getByTestId('notif-toggle').click();
  await expect(page.getByTestId('notif-sound')).toBeChecked();
  await expect(page.getByTestId('notif-browser')).not.toBeChecked();
  await expect(page.getByTestId('notif-browser')).toBeDisabled();
  await expect(page.getByTestId('notif-denied')).toBeVisible();
});
