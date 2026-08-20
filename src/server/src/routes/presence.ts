import { FastifyInstance } from 'fastify';
import { pool } from '../db';
import { authenticate } from '../auth';
import { isOnline } from '../ws';
import { getLastActiveMap } from '../chat-helpers';

// Online snapshot to seed the client after connect: returns co-members (those
// sharing at least one chat with the caller) who are currently online.
// Afterwards the client keeps it fresh via transient presence events from /ws.
export async function presenceRoutes(app: FastifyInstance): Promise<void> {
  app.get('/presence', { preHandler: authenticate }, async (req) => {
    const userId = req.user!.userId;
    const res = await pool.query(
      `SELECT DISTINCT m2.user_id FROM chat_members m1
       JOIN chat_members m2 ON m2.chat_id = m1.chat_id
       WHERE m1.user_id = $1 AND m2.user_id <> $1`,
      [userId],
    );
    const userIds = res.rows.map((r) => r.user_id as string);
    const onlineIds = userIds.filter((id) => isOnline(id));
    const lastActiveMap = await getLastActiveMap(userIds);
    const now = Date.now();
    const AWAY_MS = 5 * 60 * 1000; // 5 minutes

    const presence: Record<string, { online: boolean; away: boolean; lastActiveAt?: string }> = {};
    for (const id of userIds) {
      const online = onlineIds.includes(id);
      const lastActive = lastActiveMap.get(id) ?? null;
      const away = online && lastActive && (now - lastActive.getTime()) > AWAY_MS;
      presence[id] = {
        online,
        away: !!away,
        ...(lastActive ? { lastActiveAt: lastActive.toISOString() } : {}),
      };
    }
    return { presence };
  });
}
