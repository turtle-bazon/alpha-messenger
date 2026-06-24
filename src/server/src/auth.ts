import { hash, verify } from '@node-rs/argon2';
import { randomBytes } from 'node:crypto';
import { FastifyReply, FastifyRequest } from 'fastify';
import { pool } from './db';

declare module 'fastify' {
  interface FastifyRequest {
    user?: { userId: string; deviceId: string };
  }
}

export function hashPassword(password: string): Promise<string> {
  return hash(password);
}

export function verifyPassword(
  passwordHash: string,
  password: string,
): Promise<boolean> {
  return verify(passwordHash, password);
}

export function newToken(): string {
  return randomBytes(32).toString('base64url');
}

export async function lookupSession(
  token: string,
): Promise<{ userId: string; deviceId: string } | null> {
  const { rows } = await pool.query(
    'SELECT user_id, device_id FROM sessions WHERE token = $1',
    [token],
  );
  if (rows.length === 0) return null;
  return { userId: rows[0].user_id, deviceId: rows[0].device_id };
}

// preHandler: проверяет bearer-токен, кладёт req.user.
export async function authenticate(
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    await reply.code(401).send({ error: 'unauthorized' });
    return;
  }
  const session = await lookupSession(header.slice('Bearer '.length));
  if (!session) {
    await reply.code(401).send({ error: 'unauthorized' });
    return;
  }
  req.user = session;
}
