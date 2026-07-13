import { App } from '@capacitor/app';
import { detectAndRegisterPush, getSavedPlatform, type PushPlatform } from './push';

/**
 * Инициализация Android-клиента.
 * Вызывается из web-клиента при старте на нативной платформе.
 */
export async function initAndroid(): Promise<void> {
  console.log('Alpha: Android client initializing...');

  // Детектим и регистрируем push
  const registration = await detectAndRegisterPush();

  if (registration) {
    console.log(`Alpha: Push registered via ${registration.platform}`);
    // Сохраняем platform для web-клиента
    localStorage.setItem('alpha.push_platform', registration.platform);
    localStorage.setItem('alpha.push_token', registration.token);
  } else {
    console.log('Alpha: Push not available');
    localStorage.setItem('alpha.push_platform', 'none');
    // Показываем предупреждение пользователю
    showPushWarning(getSavedPlatform());
  }

  // Обработка жизненного цикла приложения
  App.addListener('appStateChange', ({ isActive }) => {
    if (isActive) {
      console.log('Alpha: App foregrounded');
    } else {
      console.log('Alpha: App backgrounded');
    }
  });
}

function showPushWarning(platform: PushPlatform): void {
  if (platform !== 'none') return;
  // Предупреждение показывается из web-клиента через UI
  localStorage.setItem('alpha.push_warning', 'true');
}

/**
 * Проверяет, доступны ли push-уведомления.
 */
export function isPushAvailable(): boolean {
  const platform = getSavedPlatform();
  return platform !== 'none';
}

/**
 * Получает информацию о push-платформе для UI.
 */
export function getPushInfo(): { available: boolean; platform: PushPlatform; message: string } {
  const platform = getSavedPlatform();

  if (platform === 'fcm') {
    return {
      available: true,
      platform: 'fcm',
      message: 'Уведомления активны (FCM)',
    };
  }

  if (platform === 'unifiedpush') {
    return {
      available: true,
      platform: 'unifiedpush',
      message: 'Уведомления активны (UnifiedPush)',
    };
  }

  return {
    available: false,
    platform: 'none',
    message: 'Уведомления недоступны. Установите ntfy для получения уведомлений.',
  };
}
