import { FastifyInstance } from 'fastify';
import { pool } from '../db';
import { authenticate } from '../auth';

interface DeviceBody {
  deviceId?: string;
  devicePublicKey?: string;
}

export async function deviceRoutes(app: FastifyInstance): Promise<void> {
  // Explicit device registration (usually unnecessary — the device registers
  // itself at login). Kept for future device key binding.
  app.post('/devices', { preHandler: authenticate }, async (req, reply) => {
    const { deviceId, devicePublicKey } = (req.body ?? {}) as DeviceBody;
    const userId = req.user!.userId;
    if (!deviceId) {
      return reply.code(400).send({ error: 'missing deviceId' });
    }
    await pool.query(
      `INSERT INTO devices(device_id, user_id, device_public_key)
       VALUES ($1, $2, $3)
       ON CONFLICT (device_id)
         DO UPDATE SET device_public_key = EXCLUDED.device_public_key
         WHERE devices.user_id = $2`,
      [deviceId, userId, devicePublicKey ?? null],
    );
    return reply.send({ deviceId });
  });

  // Delete a specific device and its sessions
  app.delete('/devices/:deviceId', { preHandler: authenticate }, async (req, reply) => {
    const userId = req.user!.userId;
    const { deviceId } = req.params as { deviceId: string };
    if (!deviceId) {
      return reply.code(400).send({ error: 'missing deviceId' });
    }

    // Verify the device belongs to the user
    const dev = await pool.query(
      'SELECT device_id FROM devices WHERE device_id = $1 AND user_id = $2',
      [deviceId, userId],
    );
    if (dev.rowCount === 0) {
      return reply.code(404).send({ error: 'device not found' });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Delete the device sessions
      await client.query(
        'DELETE FROM sessions WHERE device_id = $1',
        [deviceId],
      );

      // Delete the device push subscriptions
      await client.query(
        'DELETE FROM push_subscriptions WHERE device_id = $1',
        [deviceId],
      );

      // Delete the device
      await client.query(
        'DELETE FROM devices WHERE device_id = $1 AND user_id = $2',
        [deviceId, userId],
      );

      await client.query('COMMIT');
      return reply.send({ ok: true });
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  });

  // Delete all devices except the current one
  app.delete('/devices', { preHandler: authenticate }, async (req, reply) => {
    const userId = req.user!.userId;
    const currentDeviceId = req.user!.deviceId;

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Delete sessions of all devices except the current one
      await client.query(
        'DELETE FROM sessions WHERE user_id = $1 AND device_id != $2',
        [userId, currentDeviceId],
      );

      // Delete push subscriptions of all devices except the current one
      await client.query(
        'DELETE FROM push_subscriptions WHERE device_id IN (SELECT device_id FROM devices WHERE user_id = $1 AND device_id != $2)',
        [userId, currentDeviceId],
      );

      // Delete all devices except the current one
      await client.query(
        'DELETE FROM devices WHERE user_id = $1 AND device_id != $2',
        [userId, currentDeviceId],
      );

      await client.query('COMMIT');
      return reply.send({ ok: true });
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  });
}
