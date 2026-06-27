import { expect, test } from '@playwright/test';
import { registerViaUi } from './helpers/ui';

// Задачи #29 и #30: дефолты уведомлений должны явно фиксироваться в localStorage
// при входе. Дефолт browser ВСЕГДА '1' — независимо от Notification.permission
// (#30: 'denied' возникает и когда API недоступен, не только при реальной
// блокировке). При denied тумблер показывается включённым, но заблокированным
// (как в Telegram), без рассинхрона хранилища и UI.

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
