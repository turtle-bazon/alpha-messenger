import { App } from '@capacitor/app';
import { registerPlatformInit } from '../../web_client/src/util/platform';
import { detectAndRegisterPush, getSavedPlatform, type PushPlatform } from './push';

/**
 * Регистрирует android-инициализацию в platform.ts.
 * Вызывается из main.tsx android_client при старте.
 */
export function setupAndroid(): void {
  registerPlatformInit(initAndroid);
}

/**
 * Инициализация Android-клиента.
 */
async function initAndroid(): Promise<void> {
  console.log('Alpha: Android client initializing...');

  // Детектим и регистрируем push
  const registration = await detectAndRegisterPush();

  if (registration) {
    console.log(`Alpha: Push registered via ${registration.platform}`);
    localStorage.setItem('alpha.push_platform', registration.platform);
    localStorage.setItem('alpha.push_token', registration.token);
    localStorage.removeItem('alpha.push_warning');
  } else {
    console.log('Alpha: Push not available');
    localStorage.setItem('alpha.push_platform', 'none');
    showPushWarning(getSavedPlatform());
  }

  // Обработка жизненного цикла приложения
  App.addListener('appStateChange', ({ isActive }: { isActive: boolean }) => {
    if (isActive) {
      console.log('Alpha: App foregrounded');
    } else {
      console.log('Alpha: App backgrounded');
    }
  });
}

function showPushWarning(platform: PushPlatform): void {
  if (platform !== 'none') return;
  localStorage.setItem('alpha.push_warning', 'true');
}

/**
 * Проверяет, доступны ли push-уведомления.
 */
export function isPushAvailable(): boolean {
  const platform = getSavedPlatform();
  return platform !== 'none';
}
