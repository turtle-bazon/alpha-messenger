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
  // Если пользователь уже залогинен — запускаем initAndroid немедленно,
  // не дожидаясь следующего вызова initPlatform() (race condition с async import).
  if (getToken()) {
    initAndroid();
  }
}

let appStateListenerAdded = false;

async function initAndroid(): Promise<void> {
  console.log('Alpha: Android client initializing...');

  const App = Capacitor.Plugins.App;

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
    window.dispatchEvent(new Event('push-warning-changed'));

    await sendTokenToServer(registration);
  } else {
    console.log('Alpha: Push not available');
    localStorage.setItem('alpha.push_platform', 'none');
    localStorage.setItem('alpha.push_warning', 'true');
    // Уведомляем PushWarningBanner (он мог отрендериться до нашей инициализации)
    window.dispatchEvent(new Event('push-warning-changed'));
  }

  if (!appStateListenerAdded) {
    App.addListener('appStateChange', ({ isActive }: { isActive: boolean }) => {
      console.log(`Alpha: App ${isActive ? 'foregrounded' : 'backgrounded'}`);
    });
    appStateListenerAdded = true;
  }
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

  const upResult = await tryUnifiedPush();
  if (upResult) return upResult;

  const fcmResult = await tryFCM();
  if (fcmResult) return fcmResult;

  return null;
}

// --- UnifiedPush ---

async function tryUnifiedPush(): Promise<PushRegistration | null> {
  try {
    // 1. Пробуем нативный Capacitor плагин
    const upPlugin = Capacitor?.Plugins?.UnifiedPush;
    if (upPlugin) {
      return await registerWithNativeUP(upPlugin);
    }

    // 2. Пробуем ntfy HTTP API (локальный сервер на :80)
    const ntfyResult = await tryNtfyHttp();
    if (ntfyResult) return ntfyResult;
  } catch (err) {
    console.log('Alpha: UnifiedPush not available', err);
  }
  return null;
}

/**
 * Регистрация через нативный Capacitor UnifiedPush плагин.
 * Показывает UI выбора дистрибьютора если их несколько.
 */
async function registerWithNativeUP(upPlugin: any): Promise<PushRegistration | null> {
  try {
    // Получаем список дистрибьюторов
    // Capacitor возвращает JSObject {0: "a", 1: "b"} вместо ["a", "b"] —
    // нужен Array.from() для конвертации.
    const result = await upPlugin.getDistributors();
    const distributors: string[] = Array.from(result.distributors ?? []);
    if (distributors.length === 0) {
      console.log('Alpha: No UP distributors found');
      return null;
    }

    console.log('Alpha: UP distributors found:', distributors);

    // Если один — используем его, если несколько — показываем выбор
    let selectedDistributor: string | null;
    if (distributors.length === 1) {
      selectedDistributor = distributors[0];
    } else {
      selectedDistributor = await showDistributorPicker(distributors);
      if (!selectedDistributor) return null;
    }

    // Сохраняем дистрибьютора
    await upPlugin.saveDistributor({ distributor: selectedDistributor });
    console.log('Alpha: UP distributor saved:', selectedDistributor);

    // Регистрируемся
    await upPlugin.register();
    console.log('Alpha: UP registration initiated, waiting for endpoint...');

    // Ждём endpoint от PushService (до 15 секунд)
    const { endpoint } = await upPlugin.waitForEndpoint({ timeout: 15000 });
    if (!endpoint) {
      console.log('Alpha: No endpoint received from UP');
      return null;
    }

    console.log('Alpha: UP endpoint received:', endpoint);
    return { platform: 'unifiedpush', token: endpoint };
  } catch (err) {
    console.error('Alpha: Native UP registration failed', err);
    return null;
  }
}

/**
 * Пробуем ntfy HTTP API (если ntfy запущен локально).
 */
async function tryNtfyHttp(): Promise<PushRegistration | null> {
  try {
    const resp = await fetch('http://localhost:80/v1/health', {
      method: 'GET',
      signal: AbortSignal.timeout(2000),
    });
    if (!resp.ok) return null;

    console.log('Alpha: ntfy HTTP API available');

    const topic = `alpha-${crypto.randomUUID()}`;
    const endpoint = `http://localhost:80/${topic}`;

    return { platform: 'unifiedpush', token: endpoint };
  } catch {
    return null;
  }
}

// --- FCM ---

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

// --- Refresh ---

async function refreshRegistration(platform: PushPlatform): Promise<PushRegistration | null> {
  if (platform === 'fcm') {
    const pn = Capacitor?.Plugins?.PushNotifications;
    if (pn) return registerFCM(pn);
  }
  if (platform === 'unifiedpush') {
    const upPlugin = Capacitor?.Plugins?.UnifiedPush;
    if (upPlugin) {
      try {
        // Проверяем сохранённый endpoint
        const { endpoint } = await upPlugin.getEndpoint();
        if (endpoint) {
          return { platform: 'unifiedpush', token: endpoint };
        }
      } catch {
        // ignore
      }
    }
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

// --- UI ---

function showDistributorPicker(distributors: string[]): Promise<string | null> {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.setAttribute('data-testid', 'up-distributor-overlay');
    overlay.style.cssText = `
      position: fixed; inset: 0; z-index: 10000;
      background: rgba(0,0,0,0.5);
      display: flex; align-items: center; justify-content: center;
    `;

    const modal = document.createElement('div');
    modal.style.cssText = `
      background: var(--bg, #fff); border-radius: 12px;
      padding: 24px; max-width: 360px; width: 90%;
      box-shadow: 0 8px 32px rgba(0,0,0,0.2);
    `;

    const title = document.createElement('h3');
    title.textContent = 'Выберите дистрибьютор';
    title.style.cssText = 'margin: 0 0 16px 0; font-size: 17px;';

    const list = document.createElement('div');
    list.style.cssText = 'display: flex; flex-direction: column; gap: 8px;';

    distributors.forEach((d) => {
      const btn = document.createElement('button');
      btn.textContent = d;
      btn.style.cssText = `
        padding: 12px 16px; border: 1px solid var(--divider, #e0e0e0);
        border-radius: 8px; background: none; cursor: pointer;
        font-size: 15px; text-align: left;
        transition: background 0.15s;
      `;
      btn.onmouseenter = () => { btn.style.background = 'var(--bg-hover, #f0f0f0)'; };
      btn.onmouseleave = () => { btn.style.background = 'none'; };
      btn.onclick = () => {
        overlay.remove();
        resolve(d);
      };
      list.appendChild(btn);
    });

    const cancelBtn = document.createElement('button');
    cancelBtn.textContent = 'Отмена';
    cancelBtn.style.cssText = `
      margin-top: 8px; padding: 10px; border: none;
      background: none; color: var(--text-muted, #888);
      cursor: pointer; font-size: 14px; width: 100%;
    `;
    cancelBtn.onclick = () => {
      overlay.remove();
      resolve(null);
    };

    modal.appendChild(title);
    modal.appendChild(list);
    modal.appendChild(cancelBtn);
    overlay.appendChild(modal);

    overlay.onclick = (e) => {
      if (e.target === overlay) {
        overlay.remove();
        resolve(null);
      }
    };

    document.body.appendChild(overlay);
  });
}
