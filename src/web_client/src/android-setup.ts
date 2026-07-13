// Android-специфичная инициализация.
// Загружается только при запуске в Capacitor (Android WebView).
// Никаких import из @capacitor/* — работаем через window.Capacitor.

import { registerPlatformInit } from './util/platform';

type PushPlatform = 'fcm' | 'unifiedpush' | 'none';

// Capacitor API доступен через window в WebView
const Capacitor = (window as any).Capacitor;

/**
 * Регистрирует android-init в platform.ts.
 * Вызывается из main.tsx при запуске на Android.
 */
export function setupAndroid(): void {
  registerPlatformInit(initAndroid);
}

async function initAndroid(): Promise<void> {
  console.log('Alpha: Android client initializing...');

  const App = Capacitor.Plugins.App;
  const PushNotifications = Capacitor.Plugins.PushNotifications;

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

async function detectAndRegisterPush(pn: any): Promise<PushRegistration | null> {
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

async function detectPlatform(pn: any): Promise<PushPlatform> {
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

async function registerPlatform(platform: PushPlatform, pn: any): Promise<PushRegistration | null> {
  if (platform === 'fcm') return registerFCM(pn);
  return null;
}

async function registerFCM(pn: any): Promise<PushRegistration | null> {
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

async function refreshRegistration(platform: PushPlatform, pn: any): Promise<PushRegistration | null> {
  if (platform === 'fcm') return registerFCM(pn);
  return null;
}
