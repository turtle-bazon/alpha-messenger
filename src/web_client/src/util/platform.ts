// Платформо-зависимая логика.
// В браузере — заглушки. В Capacitor — импорт нативных модулей.

export type Platform = 'web' | 'android' | 'ios' | 'electron';

let cachedPlatform: Platform | null = null;

/**
 * Определяет текущую платформу.
 */
export function getPlatform(): Platform {
  if (cachedPlatform) return cachedPlatform;

  // Capacitor (Android/iOS)
  if (typeof window !== 'undefined' && (window as any).Capacitor?.isNativePlatform()) {
    const p = (window as any).Capacitor.getPlatform();
    cachedPlatform = p === 'android' ? 'android' : 'ios';
    return cachedPlatform;
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
  const platform = getPlatform();

  if (platform === 'android') {
    // Динамический импорт android_client модуля.
    // Модуль доступен только при сборке в Capacitor, в dev/vite будет ошибка — это ок.
    try {
      // @ts-expect-error android_client — отдельный проект, модуль доступен только в Capacitor
      const mod = await import('../../android_client/src/android');
      await mod.initAndroid();
    } catch {
      console.warn('Android init skipped (not in Capacitor)');
    }
  }
}

/**
 * Push доступны на этой платформе?
 */
export function isPushSupported(): boolean {
  return getPlatform() === 'android' || getPlatform() === 'ios';
}
