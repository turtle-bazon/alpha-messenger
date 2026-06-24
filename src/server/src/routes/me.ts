import { FastifyInstance } from 'fastify';
import { pool } from '../db';
import { authenticate } from '../auth';

export async function meRoutes(app: FastifyInstance): Promise<void> {
  app.get('/me', { preHandler: authenticate }, async (req) => {
    const userId = req.user!.userId;
    const acc = await pool.query(
      'SELECT user_id, username FROM accounts WHERE user_id = $1',
      [userId],
    );
    const devs = await pool.query(
      'SELECT device_id, created_at, last_seen_at FROM devices WHERE user_id = $1 ORDER BY created_at',
      [userId],
    );
    return {
      userId: acc.rows[0].user_id,
      username: acc.rows[0].username,
      devices: devs.rows.map((d) => ({
        deviceId: d.device_id,
        createdAt: d.created_at,
        lastSeenAt: d.last_seen_at,
      })),
    };
  });
}
