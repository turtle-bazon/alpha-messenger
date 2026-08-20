// Push notification types and provider detection logic.
// Used by both web_client (browser) and android_client (Capacitor).

export type PushPlatform = 'fcm' | 'unifiedpush' | 'none';

export interface PushRegistration {
  platform: PushPlatform;
  token: string;
}

const STORAGE_KEY = 'alpha.push_platform';
const TOKEN_KEY = 'alpha.push_token';
const WARNING_KEY = 'alpha.push_warning';

/**
 * Saves the push registration result.
 */
export function savePushRegistration(reg: PushRegistration): void {
  localStorage.setItem(STORAGE_KEY, reg.platform);
  localStorage.setItem(TOKEN_KEY, reg.token);
}

/**
 * Returns the saved push platform.
 */
export function getPushPlatform(): PushPlatform {
  const p = localStorage.getItem(STORAGE_KEY);
  if (p === 'fcm' || p === 'unifiedpush') return p;
  return 'none';
}

/**
 * Returns the saved push token.
 */
export function getPushToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

/**
 * Clears the push registration.
 */
export function clearPushRegistration(): void {
  localStorage.removeItem(STORAGE_KEY);
  localStorage.removeItem(TOKEN_KEY);
}

/**
 * Marks that the push warning should be shown.
 */
export function setPushWarning(show: boolean): void {
  if (show) {
    localStorage.setItem(WARNING_KEY, 'true');
  } else {
    localStorage.removeItem(WARNING_KEY);
  }
}

/**
 * Whether the push warning should be shown.
 */
export function shouldShowPushWarning(): boolean {
  return localStorage.getItem(WARNING_KEY) === 'true';
}

/**
 * Is push supported on this platform?
 */
export function isPushSupported(): boolean {
  return typeof window !== 'undefined' && !!(window as any).Capacitor?.isNativePlatform();
}
