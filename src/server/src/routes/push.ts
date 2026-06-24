import { FastifyInstance } from 'fastify';
import { pool } from '../db';
import { authenticate } from '../auth';

const PROVIDERS = new Set(['fcm', 'unifiedpush']);

interface SubscribeBody {
  deviceId?: string;
  provider?: string;
  endpoint?: string;
}

export async function pushRoutes(app: FastifyInstance): Promise<void> {
  // Регистрация канала пуша устройства. Идемпотентна по (device_id, endpoint):
  // повторная отправка того же токена вернёт ту же подписку.
  app.post(
    '/push/subscriptions',
    { preHandler: authenticate },
    async (req, reply) => {
      const { deviceId, provider, endpoint } = (req.body ??
        {}) as SubscribeBody;
      const userId = req.user!.userId;
      if (!deviceId || !provider || !endpoint) {
        return reply
          .code(400)
          .send({ error: 'missing deviceId/provider/endpoint' });
      }
      if (!PROVIDERS.has(provider)) {
        return reply.code(400).send({ error: 'unknown provider' });
      }
      // Подписать можно только собственное устройство.
      const dev = await pool.query(
        'SELECT 1 FROM devices WHERE device_id = $1 AND user_id = $2',
        [deviceId, userId],
      );
      if (dev.rowCount === 0) {
        return reply.code(404).send({ error: 'device not found' });
      }
      const { rows } = await pool.query(
        `INSERT INTO push_subscriptions(device_id, provider, endpoint)
         VALUES ($1, $2, $3)
         ON CONFLICT (device_id, endpoint)
           DO UPDATE SET provider = EXCLUDED.provider
         RETURNING subscription_id`,
        [deviceId, provider, endpoint],
      );
      return reply.code(201).send({ subscriptionId: rows[0].subscription_id });
    },
  );

  // Удаление подписки. Только своей (через принадлежность устройства аккаунту).
  app.delete(
    '/push/subscriptions/:subscriptionId',
    { preHandler: authenticate },
    async (req, reply) => {
      const { subscriptionId } = req.params as { subscriptionId: string };
      const userId = req.user!.userId;
      await pool.query(
        `DELETE FROM push_subscriptions ps
           USING devices d
          WHERE ps.subscription_id = $1
            AND ps.device_id = d.device_id
            AND d.user_id = $2`,
        [subscriptionId, userId],
      );
      // Идемпотентно: нет подписки — всё равно ok.
      return reply.send({ ok: true });
    },
  );
}
