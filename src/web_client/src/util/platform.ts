// Platform-dependent logic.
// In the browser — stubs. In Capacitor — native module imports.

export type Platform = 'web' | 'android' | 'ios' | 'electron';

let cachedPlatform: Platform | null = null;

// Runtime callback for android_client: called from android.ts at init.
let platformInitCallback: (() => Promise<void>) | null = null;

/**
 * Registers the platform init callback.
 * Called from android_client/src/android.ts at startup.
 */
export function registerPlatformInit(cb: () => Promise<void>): void {
  platformInitCallback = cb;
}

/**
 * Detects the current platform.
 */
export function getPlatform(): Platform {
  if (cachedPlatform) return cachedPlatform;

  // Capacitor (Android/iOS) — check both the Capacitor API and the userAgent in case
  // the bridge isn't initialized yet at first render.
  if (typeof window !== 'undefined') {
    if ((window as any).Capacitor?.isNativePlatform()) {
      const p = (window as any).Capacitor.getPlatform();
      cachedPlatform = p === 'android' ? 'android' : 'ios';
      return cachedPlatform;
    }
    // Fallback: userAgent contains "Capacitor" when running in a native WebView
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
 * Platform initialization (push, native plugins).
 * Called at app startup.
 */
export async function initPlatform(): Promise<void> {
  if (platformInitCallback) {
    await platformInitCallback();
  }
}

/**
 * Is push supported on this platform?
 */
export function isPushSupported(): boolean {
  return getPlatform() === 'android' || getPlatform() === 'ios';
}
