// Local session state: accessToken and a stable device deviceId.
// deviceId is generated once and survives reloads (one "device" = one browser
// profile). No persistent message cache in v1 (see architecture.md).

import { clearAll as clearMessageCache } from '../util/messageCache';

const TOKEN_KEY = 'alpha.token';
const DEVICE_KEY = 'alpha.deviceId';
const USER_KEY = 'alpha.userId';
const SEQ_KEY = 'alpha.lastSeq'; // prefix; key is per-account (SEQ_KEY.<userId>)

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

// Event stream cursor (last seen seq from the outbox), persisted across sessions.
// On hello the client sends it to the server — only missed events are replayed,
// not the whole history from scratch (see WsClient, doc/architecture.md). The key
// is per-account so different accounts in one profile don't share the cursor.
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
