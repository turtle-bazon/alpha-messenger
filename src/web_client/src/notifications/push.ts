// Push notification types and detection logic.
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
 * Сохраняет результат регистрации push.
 */
export function savePushRegistration(reg: PushRegistration): void {
  localStorage.setItem(STORAGE_KEY, reg.platform);
  localStorage.setItem(TOKEN_KEY, reg.token);
}

/**
 * Получает сохранённую push-платформу.
 */
export function getPushPlatform(): PushPlatform {
  const p = localStorage.getItem(STORAGE_KEY);
  if (p === 'fcm' || p === 'unifiedpush') return p;
  return 'none';
}

/**
 * Получает сохранённый push-токен.
 */
export function getPushToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

/**
 * Сбрасывает push-регистрацию.
 */
export function clearPushRegistration(): void {
  localStorage.removeItem(STORAGE_KEY);
  localStorage.removeItem(TOKEN_KEY);
}

/**
 * Помечает что нужно показать предупреждение о push.
 */
export function setPushWarning(show: boolean): void {
  if (show) {
    localStorage.setItem(WARNING_KEY, 'true');
  } else {
    localStorage.removeItem(WARNING_KEY);
  }
}

/**
 * Нужно ли показывать предупреждение о push.
 */
export function shouldShowPushWarning(): boolean {
  return localStorage.getItem(WARNING_KEY) === 'true';
}

/**
 * Push доступны на этой платформе?
 */
export function isPushSupported(): boolean {
  return typeof window !== 'undefined' && !!(window as any).Capacitor?.isNativePlatform();
}
