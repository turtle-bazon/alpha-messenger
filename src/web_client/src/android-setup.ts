// Android-специфичная инициализация.
// Загружается только при запуске в Capacitor (Android WebView).
// Используем динамические импорты чтобы не добавлять @capacitor/* в web_client dependencies.

import { registerPlatformInit } from './util/platform';

type PushPlatform = 'fcm' | 'unifiedpush' | 'none';

/**
 * Регистрирует android-init в platform.ts.
 * Вызывается из main.tsx при запуске на Android.
 */
export function setupAndroid(): void {
  registerPlatformInit(initAndroid);
}

async function initAndroid(): Promise<void> {
  console.log('Alpha: Android client initializing...');

  // Динамически импортируем Capacitor модули (доступны только в Android WebView)
  const { App } = await import('@capacitor/app');
  const { PushNotifications } = await import('@capacitor/push-notifications');

  const registration = await detectAndRegisterPush(PushNotifications);

  if (registration) {
    console.log(`Alpha: Push registered via ${registration.platform}`);
    localStorage.setItem('alpha.push_platform', registration.platform);
    localStorage.setItem('alpha.push_token', registration.token);
    localStorage.removeItem('alpha.push_warning');
  } else {
    console.log('Alpha: Push not available');
    localStorage.setItem('alpha.push_platform', 'none');
    localStorage.setItem('alpha.push_warning', 'true');
  }

  App.addListener('appStateChange', ({ isActive }: { isActive: boolean }) => {
    console.log(`Alpha: App ${isActive ? 'foregrounded' : 'backgrounded'}`);
  });
}

// --- Push Detection ---

interface PushRegistration {
  platform: PushPlatform;
  token: string;
}

interface PushNotificationsPlugin {
  checkPermissions(): Promise<{ receive: string }>;
  requestPermissions(): Promise<{ receive: string }>;
  register(): Promise<void>;
  addListener(event: string, cb: (data: any) => void): Promise<{ remove(): void }>;
}

async function detectAndRegisterPush(pn: PushNotificationsPlugin): Promise<PushRegistration | null> {
  const saved = localStorage.getItem('alpha.push_platform');
  if (saved === 'fcm' || saved === 'unifiedpush') {
    const refreshed = await refreshRegistration(saved, pn);
    if (refreshed) return refreshed;
    localStorage.removeItem('alpha.push_platform');
  }

  const platform = await detectPlatform(pn);
  if (platform === 'none') return null;

  return registerPlatform(platform, pn);
}

async function detectPlatform(pn: PushNotificationsPlugin): Promise<PushPlatform> {
  try {
    const result = await pn.checkPermissions();
    if (result.receive !== 'denied') {
      return 'fcm';
    }
  } catch {
    // Google Play Services недоступны
  }

  // TODO: UnifiedPush (ntfy distributor)
  return 'none';
}

async function registerPlatform(platform: PushPlatform, pn: PushNotificationsPlugin): Promise<PushRegistration | null> {
  if (platform === 'fcm') return registerFCM(pn);
  return null;
}

async function registerFCM(pn: PushNotificationsPlugin): Promise<PushRegistration | null> {
  try {
    let perm = await pn.checkPermissions();
    if (perm.receive !== 'granted') {
      perm = await pn.requestPermissions();
    }
    if (perm.receive !== 'granted') return null;

    await pn.register();

    return new Promise((resolve) => {
      const timeout = setTimeout(() => resolve(null), 10000);

      pn.addListener('registration', (token: { value: string }) => {
        clearTimeout(timeout);
        resolve({ platform: 'fcm', token: token.value });
      });

      pn.addListener('registrationError', () => {
        clearTimeout(timeout);
        resolve(null);
      });
    });
  } catch {
    return null;
  }
}

async function refreshRegistration(platform: PushPlatform, pn: PushNotificationsPlugin): Promise<PushRegistration | null> {
  if (platform === 'fcm') return registerFCM(pn);
  return null;
}
