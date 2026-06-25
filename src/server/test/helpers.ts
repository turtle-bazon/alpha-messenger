import { FastifyInstance } from 'fastify';
import { randomBytes, randomUUID } from 'node:crypto';
import { pool } from '../src/db';

export async function makeInvite(): Promise<string> {
  const code = randomBytes(12).toString('base64url');
  await pool.query('INSERT INTO invites(code) VALUES ($1)', [code]);
  return code;
}

export interface TestUser {
  username: string;
  password: string;
  deviceId: string;
  userId: string;
  token: string;
}

export async function registerUser(app: FastifyInstance): Promise<TestUser> {
  const username = `u_${randomBytes(6).toString('hex')}`;
  const password = `pw-${randomBytes(4).toString('hex')}`;
  const deviceId = randomUUID();
  const invite = await makeInvite();
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { username, password, invite, deviceId },
  });
  const body = res.json();
  return {
    username,
    password,
    deviceId,
    userId: body.userId,
    token: body.accessToken,
  };
}

export function auth(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}
