// Android-specific initialization.
// Loaded only when running in Capacitor (Android WebView).
// No imports from @capacitor/* — we work through window.Capacitor.

import { registerPlatformInit } from './util/platform';
import { getToken, getDeviceId } from './api/session';
import { subscribePush } from './api/rest';

type PushPlatform = 'fcm' | 'unifiedpush' | 'none';

// Capacitor API is available via window in the WebView
const Capacitor = (window as any).Capacitor;

/**
 * Registers android-init in platform.ts.
 * Called from main.tsx when running on Android.
 */
export function setupAndroid(): void {
  registerPlatformInit(initAndroid);
  // If the user is already logged in — run initAndroid immediately,
  // without waiting for the next initPlatform() call (race condition with async import).
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
    // Notify PushWarningBanner (it may have rendered before our initialization)
    window.dispatchEvent(new Event('push-warning-changed'));
  }

  if (!appStateListenerAdded) {
    App.addListener('appStateChange', ({ isActive }: { isActive: boolean }) => {
      console.log(`Alpha: App ${isActive ? 'foregrounded' : 'backgrounded'}`);
      // On return from background — signal the WS client to reconnect
      if (isActive) {
        window.dispatchEvent(new Event('app-foreground'));
      }
    });
    appStateListenerAdded = true;
  }
}

// --- Push Detection ---

interface PushRegistration {
  platform: PushPlatform;
  token: string;
}

async function detectAndRegisterPush(): Promise<PushRegistration | null> {
  // 1. If already registered — use the saved token (no re-registration).
  //    The endpoint is stable as long as distributor and app stay the same.
  const saved = localStorage.getItem('alpha.push_platform');
  const savedToken = localStorage.getItem('alpha.push_token');
  if (savedToken && (saved === 'fcm' || saved === 'unifiedpush')) {
    console.log(`Alpha: Using saved push registration (${saved})`);
    return { platform: saved, token: savedToken };
  }

  // 2. First registration — try UnifiedPush
  const upResult = await tryUnifiedPush();
  if (upResult) return upResult;

  // 3. Try FCM
  const fcmResult = await tryFCM();
  if (fcmResult) return fcmResult;

  return null;
}

// --- UnifiedPush ---

async function tryUnifiedPush(): Promise<PushRegistration | null> {
  try {
    // 1. Try the native Capacitor plugin
    const upPlugin = Capacitor?.Plugins?.UnifiedPush;
    if (upPlugin) {
      return await registerWithNativeUP(upPlugin);
    }

    // 2. Try the ntfy HTTP API (local server on :80)
    const ntfyResult = await tryNtfyHttp();
    if (ntfyResult) return ntfyResult;
  } catch (err) {
    console.log('Alpha: UnifiedPush not available', err);
  }
  return null;
}

/**
 * Registration via the native Capacitor UnifiedPush plugin.
 * Shows a distributor picker UI if there are several.
 */
async function registerWithNativeUP(upPlugin: any): Promise<PushRegistration | null> {
  try {
    // Get the list of distributors.
    // Capacitor may return: JSObject, string, or array — handle all cases.
    const raw = await upPlugin.getDistributors();
    console.log('Alpha: raw getDistributors:', JSON.stringify(raw));

    let distributors: string[] = [];
    const list = raw?.distributors ?? raw;

    if (Array.isArray(list)) {
      distributors = list.map(String);
    } else if (typeof list === 'string') {
      // Capacitor sometimes serializes List<String> as the string "[a, b]"
      const cleaned = list.replace(/^\[|\]$/g, '');
      distributors = cleaned.split(',').map(s => s.trim()).filter(Boolean);
    } else if (list && typeof list === 'object') {
      // JSObject {0: "a", 1: "b"} — convert via Object.values
      distributors = Object.values(list).map(String);
    }

    if (distributors.length === 0) {
      console.log('Alpha: No UP distributors found');
      return null;
    }

    console.log('Alpha: UP distributors ready:', JSON.stringify(distributors));

    // If one — use it; if several — show a picker
    let selectedDistributor: string | null;
    if (distributors.length === 1) {
      selectedDistributor = distributors[0];
    } else {
      selectedDistributor = await showDistributorPicker(distributors);
      if (!selectedDistributor) return null;
    }

    // Save the distributor
    await upPlugin.saveDistributor({ distributor: selectedDistributor });
    console.log('Alpha: UP distributor saved:', selectedDistributor);

    // Register
    await upPlugin.register();
    console.log('Alpha: UP registration initiated, waiting for endpoint...');

    // Wait for the endpoint from PushService (up to 15 seconds)
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
 * Try the ntfy HTTP API (if ntfy runs locally).
 * UnifiedPush topics in ntfy start with an "up" prefix.
 */
async function tryNtfyHttp(): Promise<PushRegistration | null> {
  try {
    const resp = await fetch('http://localhost:80/v1/health', {
      method: 'GET',
      signal: AbortSignal.timeout(2000),
    });
    if (!resp.ok) return null;

    console.log('Alpha: ntfy HTTP API available');

    // UnifiedPush topics in ntfy must start with an "up" prefix
    const topic = `up${crypto.randomUUID().replace(/-/g, '').substring(0, 16)}`;
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
