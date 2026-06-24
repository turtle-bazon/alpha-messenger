// Локальное состояние сессии: accessToken и стабильный deviceId устройства.
// deviceId генерится один раз и переживает перезагрузки (одно «устройство» = один
// браузерный профиль). Постоянного кэша сообщений в v1 нет (см. architecture.md).

const TOKEN_KEY = 'alpha.token';
const DEVICE_KEY = 'alpha.deviceId';
const USER_KEY = 'alpha.userId';

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setSession(token: string, userId: string): void {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(USER_KEY, userId);
}

export function getUserId(): string | null {
  return localStorage.getItem(USER_KEY);
}

export function clearSession(): void {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

export function getDeviceId(): string {
  let id = localStorage.getItem(DEVICE_KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(DEVICE_KEY, id);
  }
  return id;
}
