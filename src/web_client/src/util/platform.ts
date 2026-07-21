// Платформо-зависимая логика.
// В браузере — заглушки. В Capacitor — импорт нативных модулей.

export type Platform = 'web' | 'android' | 'ios' | 'electron';

let cachedPlatform: Platform | null = null;

// Runtime-callback для android_client: вызывается из android.ts при инициализации.
let platformInitCallback: (() => Promise<void>) | null = null;

/**
 * Регистрирует callback инициализации платформы.
 * Вызывается из android_client/src/android.ts при старте.
 */
export function registerPlatformInit(cb: () => Promise<void>): void {
  platformInitCallback = cb;
}

/**
 * Определяет текущую платформу.
 */
export function getPlatform(): Platform {
  if (cachedPlatform) return cachedPlatform;

  // Capacitor (Android/iOS) — проверяем и Capacitor API, и userAgent на случай
  // если мост ещё не инициализирован к моменту первого рендера.
  if (typeof window !== 'undefined') {
    if ((window as any).Capacitor?.isNativePlatform()) {
      const p = (window as any).Capacitor.getPlatform();
      cachedPlatform = p === 'android' ? 'android' : 'ios';
      return cachedPlatform;
    }
    // Фолбэк: userAgent содержит "Capacitor" при запуске в нативном WebView
    const ua = navigator.userAgent;
    if (ua.includes('Capacitor')) {
      cachedPlatform = ua.includes('Android') ? 'android' : 'ios';
      return cachedPlatform;
    }
  }

  // Electron
  if (typeof window !== 'undefined' && (window as any).electronAPI) {
    cachedPlatform = 'electron';
    return cachedPlatform;
  }

  cachedPlatform = 'web';
  return cachedPlatform;
}

/**
 * Инициализация платформы (push, нативные плагины).
 * Вызывается при старте приложения.
 */
export async function initPlatform(): Promise<void> {
  if (platformInitCallback) {
    await platformInitCallback();
  }
}

/**
 * Push доступны на этой платформе?
 */
export function isPushSupported(): boolean {
  return getPlatform() === 'android' || getPlatform() === 'ios';
}
