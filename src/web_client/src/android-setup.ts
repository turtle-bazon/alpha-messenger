// Android-специфичная инициализация.
// Загружается только при запуске в Capacitor (Android WebView).
// Никаких import из @capacitor/* — работаем через window.Capacitor.

import { registerPlatformInit } from './util/platform';
import { getToken } from './api/session';
import { subscribePush } from './api/rest';

type PushPlatform = 'fcm' | 'unifiedpush' | 'none';

// Capacitor API доступен через window в WebView
const Capacitor = (window as any).Capacitor;

const DEVICE_ID_KEY = 'alpha.device_id';

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

  // Устройство должно быть зарегистрировано (через auth/register или auth/login).
  // Если токена нет — ещё не вошли, push не регистрируем.
  if (!getToken()) {
    console.log('Alpha: Not logged in, skipping push registration');
    return;
  }

  const registration = await detectAndRegisterPush();

  if (registration) {
    console.log(`Alpha: Push registered via ${registration.platform}`);
    localStorage.setItem('alpha.push_platform', registration.platform);
    localStorage.setItem('alpha.push_token', registration.token);
    localStorage.removeItem('alpha.push_warning');

    // Отправляем токен на сервер
    await sendTokenToServer(registration);
  } else {
    console.log('Alpha: Push not available');
    localStorage.setItem('alpha.push_platform', 'none');
    localStorage.setItem('alpha.push_warning', 'true');
  }

  App.addListener('appStateChange', ({ isActive }: { isActive: boolean }) => {
    console.log(`Alpha: App ${isActive ? 'foregrounded' : 'backgrounded'}`);
  });
}

// --- Device ID ---

function getDeviceId(): string {
  let id = localStorage.getItem(DEVICE_ID_KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(DEVICE_ID_KEY, id);
  }
  return id;
}

// --- Push Detection ---

interface PushRegistration {
  platform: PushPlatform;
  token: string;
}

async function detectAndRegisterPush(): Promise<PushRegistration | null> {
  const saved = localStorage.getItem('alpha.push_platform');
  if (saved === 'fcm' || saved === 'unifiedpush') {
    const refreshed = await refreshRegistration(saved);
    if (refreshed) return refreshed;
    localStorage.removeItem('alpha.push_platform');
  }

  // Пробуем сначала UnifiedPush (дефолт), потом FCM (фолбэк)
  const upResult = await tryUnifiedPush();
  if (upResult) return upResult;

  const fcmResult = await tryFCM();
  if (fcmResult) return fcmResult;

  return null;
}

async function tryUnifiedPush(): Promise<PushRegistration | null> {
  try {
    // UnifiedPush через Capacitor HTTP или WebView fetch
    // Проверяем доступность ntfy distributor
    const upPlugin = Capacitor?.Plugins?.UnifiedPush;
    if (upPlugin) {
      return await registerUnifiedPushNative(upPlugin);
    }

    // Фолбэк: Web UnifiedPush API (если доступен)
    if ('serviceWorker' in navigator && 'PushManager' in window) {
      return await registerUnifiedPushWeb();
    }
  } catch (err) {
    console.log('Alpha: UnifiedPush not available', err);
  }
  return null;
}

async function registerUnifiedPushNative(upPlugin: any): Promise<PushRegistration | null> {
  try {
    // Запрашиваем список доступных дистрибьюторов
    const distributors = await upPlugin.getDistributors();
    if (!distributors || distributors.length === 0) return null;

    // Если несколько — выбираем первый (в будущем: UI выбора)
    const distributor = distributors[0];

    // Генерируем уникальный топик для этого клиента
    const topic = `alpha-${crypto.randomUUID()}`;

    // Регистрируемся у дистрибьютора с нашим топиком
    const endpoint = await upPlugin.register({ distributor, topic });
    if (!endpoint) return null;

    // endpoint — полный URL для отправки (например, https://ntfy.sh/alpha-xxx)
    return { platform: 'unifiedpush', token: endpoint };
  } catch {
    return null;
  }
}

async function registerUnifiedPushWeb(): Promise<PushRegistration | null> {
  // Web Push через service worker — требует VAPID ключ
  // Пока заглушка, основной путь — нативный
  return null;
}

async function tryFCM(): Promise<PushRegistration | null> {
  const pn = Capacitor?.Plugins?.PushNotifications;
  if (!pn) return null;
  return registerFCM(pn);
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

async function refreshRegistration(platform: PushPlatform): Promise<PushRegistration | null> {
  if (platform === 'fcm') {
    const pn = Capacitor?.Plugins?.PushNotifications;
    if (pn) return registerFCM(pn);
  }
  if (platform === 'unifiedpush') {
    return tryUnifiedPush();
  }
  return null;
}

// --- Server Registration ---

async function sendTokenToServer(reg: PushRegistration): Promise<void> {
  try {
    const deviceId = getDeviceId();
    await subscribePush({
      deviceId,
      provider: reg.platform,
      endpoint: reg.token,
    });
    console.log(`Alpha: Push subscription sent to server (${reg.platform})`);
  } catch (err) {
    console.error('Alpha: Failed to send push subscription to server', err);
  }
}
