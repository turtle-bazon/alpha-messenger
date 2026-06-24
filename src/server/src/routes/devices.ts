import { FastifyInstance } from 'fastify';
import { pool } from '../db';
import { authenticate } from '../auth';

interface DeviceBody {
  deviceId?: string;
  devicePublicKey?: string;
}

export async function deviceRoutes(app: FastifyInstance): Promise<void> {
  // Явная регистрация устройства (обычно не нужна — устройство регистрируется
  // само при логине). Оставлено для будущей привязки ключа устройства.
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
}
