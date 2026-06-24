import { FastifyInstance, FastifyRequest } from 'fastify';
import { pool } from '../db';
import { emitEvent } from '../events';
import { hashPassword, newToken, verifyPassword } from '../auth';

interface RegisterBody {
  username?: string;
  password?: string;
  invite?: string;
  deviceId?: string;
}

interface LoginBody {
  username?: string;
  password?: string;
  deviceId?: string;
}

function authAttemptPayload(
  req: FastifyRequest,
  deviceId: string,
): Record<string, unknown> {
  return {
    deviceId,
    ip: req.ip,
    userAgent: req.headers['user-agent'] ?? null,
    ts: new Date().toISOString(),
  };
}

export async function authRoutes(app: FastifyInstance): Promise<void> {
  app.post('/auth/register', async (req, reply) => {
    const { username, password, invite, deviceId } = (req.body ??
      {}) as RegisterBody;
    if (!username || !password || !invite || !deviceId) {
      return reply.code(400).send({ error: 'missing fields' });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const inv = await client.query(
        `SELECT code FROM invites
         WHERE code = $1 AND used_at IS NULL
           AND (expires_at IS NULL OR expires_at > now())
         FOR UPDATE`,
        [invite],
      );
      if (inv.rowCount === 0) {
        await client.query('ROLLBACK');
        return reply.code(400).send({ error: 'invalid invite' });
      }

      let userId: string;
      try {
        const acc = await client.query(
          'INSERT INTO accounts(username, password_hash) VALUES ($1, $2) RETURNING user_id',
          [username, await hashPassword(password)],
        );
        userId = acc.rows[0].user_id;
      } catch (err) {
        await client.query('ROLLBACK');
        if ((err as { code?: string }).code === '23505') {
          return reply.code(409).send({ error: 'username taken' });
        }
        throw err;
      }

      await client.query(
        'UPDATE invites SET used_by = $1, used_at = now() WHERE code = $2',
        [userId, invite],
      );

      await client.query(
        'INSERT INTO devices(device_id, user_id) VALUES ($1, $2)',
        [deviceId, userId],
      );
      await emitEvent(client, userId, 'device.added', {
        deviceId,
        ts: new Date().toISOString(),
      });
      await emitEvent(
        client,
        userId,
        'auth.attempt',
        authAttemptPayload(req, deviceId),
      );

      const token = newToken();
      await client.query(
        'INSERT INTO sessions(token, user_id, device_id) VALUES ($1, $2, $3)',
        [token, userId, deviceId],
      );

      await client.query('COMMIT');
      return reply.code(201).send({ userId, username, accessToken: token });
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  });

  app.post('/auth/login', async (req, reply) => {
    const { username, password, deviceId } = (req.body ?? {}) as LoginBody;
    if (!username || !password || !deviceId) {
      return reply.code(400).send({ error: 'missing fields' });
    }

    const accRes = await pool.query(
      'SELECT user_id, password_hash FROM accounts WHERE username = $1',
      [username],
    );
    if (accRes.rowCount === 0) {
      return reply.code(401).send({ error: 'invalid credentials' });
    }
    const userId: string = accRes.rows[0].user_id;
    const ok = await verifyPassword(accRes.rows[0].password_hash, password);
    if (!ok) {
      return reply.code(401).send({ error: 'invalid credentials' });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const dev = await client.query(
        'SELECT device_id FROM devices WHERE device_id = $1 AND user_id = $2',
        [deviceId, userId],
      );
      if (dev.rowCount === 0) {
        await client.query(
          'INSERT INTO devices(device_id, user_id) VALUES ($1, $2)',
          [deviceId, userId],
        );
        await emitEvent(client, userId, 'device.added', {
          deviceId,
          ts: new Date().toISOString(),
        });
      }
      await emitEvent(
        client,
        userId,
        'auth.attempt',
        authAttemptPayload(req, deviceId),
      );
      await client.query(
        'UPDATE devices SET last_seen_at = now() WHERE device_id = $1',
        [deviceId],
      );

      const token = newToken();
      await client.query(
        'INSERT INTO sessions(token, user_id, device_id) VALUES ($1, $2, $3)',
        [token, userId, deviceId],
      );

      await client.query('COMMIT');
      return reply.send({ userId, accessToken: token });
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  });
}
