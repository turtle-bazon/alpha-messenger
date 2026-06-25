import { FastifyInstance } from 'fastify';
import { pool } from '../db';
import { authenticate } from '../auth';
import { isOnline } from '../ws';

// Снимок онлайна для сидирования клиента после коннекта: возвращает тех
// со-участников (с кем вызывающий делит хотя бы один чат), кто сейчас в сети.
// Дальше актуальность клиент держит по транзиентным событиям presence из /ws.
export async function presenceRoutes(app: FastifyInstance): Promise<void> {
  app.get('/presence', { preHandler: authenticate }, async (req) => {
    const userId = req.user!.userId;
    const res = await pool.query(
      `SELECT DISTINCT m2.user_id FROM chat_members m1
       JOIN chat_members m2 ON m2.chat_id = m1.chat_id
       WHERE m1.user_id = $1 AND m2.user_id <> $1`,
      [userId],
    );
    const online = res.rows
      .map((r) => r.user_id as string)
      .filter((id) => isOnline(id));
    return { online };
  });
}
