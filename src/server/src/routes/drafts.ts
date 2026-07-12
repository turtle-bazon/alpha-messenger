import { FastifyInstance } from 'fastify';
import { pool } from '../db';
import { authenticate } from '../auth';
import { isMember } from '../chat-helpers';

interface DraftBody {
  ciphertext?: string;
}

export async function draftRoutes(app: FastifyInstance): Promise<void> {
  // GET /chats/:chatId/draft — получить черновик
  app.get(
    '/chats/:chatId/draft',
    { preHandler: authenticate },
    async (req, reply) => {
      const userId = req.user!.userId;
      const { chatId } = req.params as { chatId: string };

      if (!(await isMember(chatId, userId))) {
        return reply.code(403).send({ error: 'forbidden' });
      }

      const result = await pool.query(
        'SELECT ciphertext FROM drafts WHERE chat_id = $1 AND user_id = $2',
        [chatId, userId],
      );

      if (result.rowCount === 0) {
        return { ciphertext: '' };
      }

      return { ciphertext: result.rows[0].ciphertext };
    },
  );

  // PUT /chats/:chatId/draft — сохранить черновик
  app.put(
    '/chats/:chatId/draft',
    { preHandler: authenticate },
    async (req, reply) => {
      const userId = req.user!.userId;
      const { chatId } = req.params as { chatId: string };
      const { ciphertext } = (req.body ?? {}) as DraftBody;

      if (typeof ciphertext !== 'string') {
        return reply.code(400).send({ error: 'ciphertext must be a string' });
      }

      if (!(await isMember(chatId, userId))) {
        return reply.code(403).send({ error: 'forbidden' });
      }

      await pool.query(
        `INSERT INTO drafts (chat_id, user_id, ciphertext, updated_at)
         VALUES ($1, $2, $3, now())
         ON CONFLICT (chat_id, user_id)
         DO UPDATE SET ciphertext = EXCLUDED.ciphertext, updated_at = now()`,
        [chatId, userId, ciphertext],
      );

      return { ok: true };
    },
  );

  // DELETE /chats/:chatId/draft — удалить черновик
  app.delete(
    '/chats/:chatId/draft',
    { preHandler: authenticate },
    async (req, reply) => {
      const userId = req.user!.userId;
      const { chatId } = req.params as { chatId: string };

      if (!(await isMember(chatId, userId))) {
        return reply.code(403).send({ error: 'forbidden' });
      }

      await pool.query(
        'DELETE FROM drafts WHERE chat_id = $1 AND user_id = $2',
        [chatId, userId],
      );

      return { ok: true };
    },
  );
}
