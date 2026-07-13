import { PushNotifications } from '@capacitor/push-notifications';
import { Capacitor } from '@capacitor/core';

// Платформы push-уведомлений
export type PushPlatform = 'fcm' | 'unifiedpush' | 'none';

// Регистрационные данные
interface PushRegistration {
  platform: PushPlatform;
  token: string; // FCM token или UP distributor endpoint
}

const STORAGE_KEY = 'alpha.push_platform';

/**
 * Определяет доступные push-платформы и регистрирует лучшую.
 * Результат кэшируется в localStorage.
 */
export async function detectAndRegisterPush(): Promise<PushRegistration | null> {
  // Проверяем кэш
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved) {
    const parsed = JSON.parse(saved) as PushRegistration;
    // Пытаемся переиспользовать сохранённую регистрацию
    const refreshed = await refreshRegistration(parsed.platform);
    if (refreshed) return refreshed;
    // Если не удалось — сбрасываем кэш и детектим заново
    localStorage.removeItem(STORAGE_KEY);
  }

  // Детектим платформу
  const platform = await detectPlatform();
  if (platform === 'none') return null;

  const registration = await registerPlatform(platform);
  if (registration) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(registration));
  }
  return registration;
}

/**
 * Получает сохранённую платформу без повторной регистрации.
 */
export function getSavedPlatform(): PushPlatform {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (!saved) return 'none';
  try {
    const parsed = JSON.parse(saved) as PushRegistration;
    return parsed.platform;
  } catch {
    return 'none';
  }
}

/**
 * Сбрасывает кэш и перерегистрируется.
 */
export async function reRegisterPush(): Promise<PushRegistration | null> {
  localStorage.removeItem(STORAGE_KEY);
  return detectAndRegisterPush();
}

// --- Internal ---

async function detectPlatform(): Promise<PushPlatform> {
  if (!Capacitor.isNativePlatform()) {
    // В браузере — push не работает
    return 'none';
  }

  // Проверяем FCM (Google Play Services)
  if (Capacitor.getPlatform() === 'android') {
    try {
      const result = await PushNotifications.checkPermissions();
      if (result.receive !== 'denied') {
        return 'fcm';
      }
    } catch {
      // Google Play Services недоступны
    }
  }

  // Проверяем UnifiedPush (ntfy или другой distributor)
  if (await hasUnifiedPushDistributor()) {
    return 'unifiedpush';
  }

  return 'none';
}

async function registerPlatform(platform: PushPlatform): Promise<PushRegistration | null> {
  switch (platform) {
    case 'fcm':
      return registerFCM();
    case 'unifiedpush':
      return registerUnifiedPush();
    default:
      return null;
  }
}

async function registerFCM(): Promise<PushRegistration | null> {
  try {
    // Запрашиваем разрешение
    let perm = await PushNotifications.checkPermissions();
    if (perm.receive !== 'granted') {
      perm = await PushNotifications.requestPermissions();
    }
    if (perm.receive !== 'granted') return null;

    // Регистрируемся для получения токена
    await PushNotifications.register();

    // Ждём токен
    return new Promise((resolve) => {
      const timeout = setTimeout(() => resolve(null), 10000);

      PushNotifications.addListener('registration', (token) => {
        clearTimeout(timeout);
        resolve({ platform: 'fcm', token: token.value });
      });

      PushNotifications.addListener('registrationError', () => {
        clearTimeout(timeout);
        resolve(null);
      });
    });
  } catch {
    return null;
  }
}

async function registerUnifiedPush(): Promise<PushRegistration | null> {
  // UnifiedPush регистрация через ntfy distributor
  // Пока заглушка — реальная интеграция зависит от выбранного distributor'а
  console.log('UnifiedPush: registration placeholder');
  return null;
}

async function hasUnifiedPushDistributor(): Promise<boolean> {
  // Проверяем наличие UP distributor'а (ntfy, Gotify, microG)
  // Реальная проверка зависит от платформы и установленных приложений
  try {
    // Пока заглушка — всегда false до реальной интеграции
    return false;
  } catch {
    return false;
  }
}

async function refreshRegistration(platform: PushPlatform): Promise<PushRegistration | null> {
  // Пытаемся обновить токен для существующей платформы
  switch (platform) {
    case 'fcm':
      return registerFCM();
    case 'unifiedpush':
      return registerUnifiedPush();
    default:
      return null;
  }
}
