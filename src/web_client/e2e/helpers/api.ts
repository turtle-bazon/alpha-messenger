import { randomUUID } from 'node:crypto';
import { createInvite } from './db';

// Регистрация пользователя напрямую через серверный REST (минуя UI) — нужна,
// чтобы в сценарии существовал «собеседник» для другого пользователя.
const API = process.env.E2E_API_URL ?? 'http://localhost:3000';

export interface ApiUser {
  username: string;
  password: string;
  deviceId: string;
  userId: string;
  token: string;
}

export async function registerViaApi(): Promise<ApiUser> {
  const invite = await createInvite();
  const username = `u_${randomUUID().slice(0, 8)}`;
  const password = 'pw-secret-123';
  const deviceId = randomUUID();
  const res = await fetch(`${API}/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password, invite, deviceId }),
  });
  if (!res.ok) throw new Error(`register failed: ${res.status}`);
  const body = (await res.json()) as { userId: string; accessToken: string };
  return {
    username,
    password,
    deviceId,
    userId: body.userId,
    token: body.accessToken,
  };
}
