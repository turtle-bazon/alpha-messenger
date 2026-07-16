// Локальное состояние сессии: accessToken и стабильный deviceId устройства.
// deviceId генерится один раз и переживает перезагрузки (одно «устройство» = один
// браузерный профиль). Постоянного кэша сообщений в v1 нет (см. architecture.md).

import { clearAll as clearMessageCache } from '../util/messageCache';

const TOKEN_KEY = 'alpha.token';
const DEVICE_KEY = 'alpha.deviceId';
const USER_KEY = 'alpha.userId';
const SEQ_KEY = 'alpha.lastSeq'; // префикс; ключ — per-account (SEQ_KEY.<userId>)

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
  const uid = getUserId();
  if (uid) localStorage.removeItem(`${SEQ_KEY}.${uid}`);
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
  clearMessageCache().catch(() => undefined);
}

// Курсор потока событий (последний виденный seq из outbox), сохранённый между
// сессиями. При hello клиент передаёт его серверу — реплеится только пропущенное,
// а не вся история с нуля (см. WsClient, doc/architecture.md). Ключ — per-account,
// чтобы разные аккаунты в одном профиле не делили курсор.
export function getLastSeq(): number {
  const uid = getUserId();
  if (!uid) return 0;
  const raw = localStorage.getItem(`${SEQ_KEY}.${uid}`);
  const n = raw ? Number(raw) : 0;
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export function setLastSeq(seq: number): void {
  const uid = getUserId();
  if (!uid) return;
  localStorage.setItem(`${SEQ_KEY}.${uid}`, String(seq));
}

export function getDeviceId(): string {
  let id = localStorage.getItem(DEVICE_KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(DEVICE_KEY, id);
  }
  return id;
}
