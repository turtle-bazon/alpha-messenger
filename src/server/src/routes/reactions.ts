import { FastifyInstance } from 'fastify';
import { pool } from '../db';
import { authenticate } from '../auth';
import { emitToMembers, isMember } from '../chat-helpers';

interface ReactionBody {
  emoji?: string;
}

export async function reactionRoutes(app: FastifyInstance): Promise<void> {
  // PUT /messages/:messageId/reactions — toggle реакции.
  // Если у пользователя уже стоит реакция на этом сообщении:
  //   - тот же эмодзи → удаляем (toggle off)
  //   - другой эмодзи → заменяем
  // Если реакции нет — добавляем.
  app.put(
    '/messages/:messageId/reactions',
    { preHandler: authenticate },
    async (req, reply) => {
      const userId = req.user!.userId;
      const { messageId } = req.params as { messageId: string };
      const { emoji } = (req.body ?? {}) as ReactionBody;

      if (!emoji || typeof emoji !== 'string' || emoji.length > 16) {
        return reply.code(400).send({ error: 'invalid emoji' });
      }

      // Проверяем существование сообщения и получаем chat_id
      const msg = await pool.query(
        'SELECT chat_id FROM messages WHERE message_id = $1',
        [messageId],
      );
      if (msg.rowCount === 0) {
        return reply.code(404).send({ error: 'not found' });
      }
      const chatId: string = msg.rows[0].chat_id;

      if (!(await isMember(chatId, userId))) {
        return reply.code(403).send({ error: 'forbidden' });
      }

      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        // Проверяем текущую реакцию пользователя
        const existing = await client.query(
          'SELECT emoji FROM message_reactions WHERE message_id = $1 AND user_id = $2',
          [messageId, userId],
        );

        let action: 'added' | 'removed' | 'replaced';
        let removedEmoji: string | null = null;

        if (existing.rowCount === 0) {
          // Нет реакции — добавляем
          await client.query(
            'INSERT INTO message_reactions (message_id, user_id, emoji) VALUES ($1, $2, $3)',
            [messageId, userId, emoji],
          );
          action = 'added';
        } else if (existing.rows[0].emoji === emoji) {
          // Тот же эмодзи — удаляем (toggle off)
          await client.query(
            'DELETE FROM message_reactions WHERE message_id = $1 AND user_id = $2',
            [messageId, userId],
          );
          action = 'removed';
          removedEmoji = emoji;
        } else {
          // Другой эмодзи — заменяем
          await client.query(
            'UPDATE message_reactions SET emoji = $3 WHERE message_id = $1 AND user_id = $2',
            [messageId, userId, emoji],
          );
          action = 'replaced';
          removedEmoji = existing.rows[0].emoji;
        }

        // Получаем обновлённый набор реакций
        const reactions = await getReactions(client, messageId);

        await emitToMembers(client, chatId, 'message.reaction', {
          messageId,
          userId,
          emoji,
          action,
          removedEmoji,
          reactions,
        });

        await client.query('COMMIT');
        return reply.send({ reactions, action, removedEmoji });
      } catch (err) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw err;
      } finally {
        client.release();
      }
    },
  );
}

/** Получить все реакции на сообщение, сгруппированные по эмодзи. */
export async function getReactions(
  db: { query: (sql: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }> },
  messageId: string,
): Promise<ReactionGroup[]> {
  const res = await db.query(
    `SELECT emoji, array_agg(user_id) AS users
     FROM message_reactions
     WHERE message_id = $1
     GROUP BY emoji
     ORDER BY count(*) DESC, emoji`,
    [messageId],
  );
  return res.rows.map((r) => ({
    emoji: r.emoji as string,
    users: r.users as string[],
    count: (r.users as string[]).length,
  }));
}

export interface ReactionGroup {
  emoji: string;
  users: string[];
  count: number;
}
