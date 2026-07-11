import { FastifyInstance } from 'fastify';
import { pool } from '../db';
import { authenticate } from '../auth';
import { emitToMembers, isMember, markRead } from '../chat-helpers';
import { HEX64 } from './blobs';
import { getReactions, ReactionGroup } from './reactions';

interface SendBody {
  clientMessageId?: string;
  ciphertext?: string;
  // Открытые ссылки на загруженные блобы (вложения). Серверу нужны явно: из
  // зашифрованного ciphertext он их прочесть не может. Ключи расшифровки
  // остаются внутри ciphertext — здесь только идентификаторы.
  blobIds?: string[];
  // Ответ на сообщение: ID сообщения, на которое отвечаем.
  replyToMessageId?: string;
}

const MAX_BLOBS_PER_MESSAGE = 16;

export async function messageRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    '/chats/:chatId/messages',
    { preHandler: authenticate },
    async (req, reply) => {
      const userId = req.user!.userId;
      const { chatId } = req.params as { chatId: string };
      const { clientMessageId, ciphertext, blobIds, replyToMessageId } = (req.body ??
        {}) as SendBody;

      if (!clientMessageId || !ciphertext) {
        return reply.code(400).send({ error: 'missing fields' });
      }

      // Валидация вложений: формат хэшей, лимит количества, существование.
      let attachIds: string[] = [];
      if (blobIds !== undefined) {
        if (
          !Array.isArray(blobIds) ||
          blobIds.length > MAX_BLOBS_PER_MESSAGE ||
          !blobIds.every((x) => typeof x === 'string' && HEX64.test(x))
        ) {
          return reply.code(400).send({ error: 'invalid blobIds' });
        }
        attachIds = [...new Set(blobIds)];
        if (attachIds.length > 0) {
          const found = await pool.query(
            'SELECT blob_id FROM blobs WHERE blob_id = ANY($1)',
            [attachIds],
          );
          if (found.rowCount !== attachIds.length) {
            return reply.code(400).send({ error: 'unknown blob' });
          }
        }
      }

      if (!(await isMember(chatId, userId))) {
        return reply.code(404).send({ error: 'not found' });
      }

      // Валидация replyToMessageId: должно быть числовым ID сообщения в этом чате.
      let replyToId: string | null = null;
      if (replyToMessageId !== undefined) {
        if (!/^\d+$/.test(replyToMessageId)) {
          return reply.code(400).send({ error: 'invalid replyToMessageId' });
        }
        const refMsg = await pool.query(
          'SELECT message_id FROM messages WHERE message_id = $1 AND chat_id = $2',
          [replyToMessageId, chatId],
        );
        if (refMsg.rowCount === 0) {
          return reply.code(400).send({ error: 'replyToMessageId not found' });
        }
        replyToId = replyToMessageId;
      }

      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const ins = await client.query(
          `INSERT INTO messages(chat_id, sender_id, client_message_id, ciphertext, reply_to_message_id)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (chat_id, sender_id, client_message_id) DO NOTHING
           RETURNING message_id, created_at`,
          [chatId, userId, clientMessageId, Buffer.from(ciphertext, 'base64'), replyToId],
        );

        // идемпотентность: повтор с тем же clientMessageId не создаёт дубль
        if (ins.rowCount === 0) {
          await client.query('ROLLBACK');
          const ex = await pool.query(
            `SELECT message_id, created_at, reply_to_message_id FROM messages
             WHERE chat_id = $1 AND sender_id = $2 AND client_message_id = $3`,
            [chatId, userId, clientMessageId],
          );
          const row = ex.rows[0];
          return reply.code(200).send({
            messageId: row.message_id,
            clientMessageId,
            ts: row.created_at.toISOString(),
            replyToMessageId: row.reply_to_message_id,
          });
        }

        const messageId: string = ins.rows[0].message_id;
        const ts: Date = ins.rows[0].created_at;
        for (const blobId of attachIds) {
          await client.query(
            `INSERT INTO message_blobs(message_id, blob_id)
             VALUES ($1, $2) ON CONFLICT DO NOTHING`,
            [messageId, blobId],
          );
        }
        await client.query('UPDATE chats SET updated_at = now() WHERE chat_id = $1', [
          chatId,
        ]);
        await emitToMembers(client, chatId, 'message.new', {
          messageId,
          senderId: userId,
          clientMessageId,
          ciphertext,
          blobIds: attachIds,
          ts: ts.toISOString(),
          replyToMessageId: replyToId,
          isReply: !!replyToId,
        });
        await client.query('COMMIT');
        return reply.code(201).send({
          messageId,
          clientMessageId,
          blobIds: attachIds,
          ts: ts.toISOString(),
          replyToMessageId: replyToId,
        });
      } catch (err) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw err;
      } finally {
        client.release();
      }
    },
  );

  app.get(
    '/chats/:chatId/messages',
    { preHandler: authenticate },
    async (req, reply) => {
      const userId = req.user!.userId;
      const { chatId } = req.params as { chatId: string };
      if (!(await isMember(chatId, userId))) {
        return reply.code(404).send({ error: 'not found' });
      }

      const q = req.query as { before?: string; limit?: string };
      const before = q.before && /^\d+$/.test(q.before) ? q.before : null;
      let limit = Number(q.limit ?? 50);
      if (!Number.isFinite(limit) || limit < 1) limit = 50;
      if (limit > 100) limit = 100;

      const res = await pool.query(
        `SELECT m.message_id, m.sender_id, m.ciphertext, m.created_at,
                m.edited_at, m.deleted, m.reply_to_message_id,
                COALESCE(
                  array_agg(mb.blob_id) FILTER (WHERE mb.blob_id IS NOT NULL),
                  '{}'
                ) AS blob_ids
         FROM messages m
         LEFT JOIN message_blobs mb ON mb.message_id = m.message_id
         WHERE m.chat_id = $1 AND ($2::bigint IS NULL OR m.message_id < $2::bigint)
         GROUP BY m.message_id
         ORDER BY m.message_id DESC
         LIMIT $3`,
        [chatId, before, limit + 1],
      );

      const hasMore = res.rowCount! > limit;
      const slice = res.rows.slice(0, limit);
      const messages = slice.map((r) => ({
        messageId: r.message_id,
        senderId: r.sender_id,
        ciphertext: (r.ciphertext as Buffer).toString('base64'),
        blobIds: r.blob_ids as string[],
        ts: r.created_at.toISOString(),
        editedAt: r.edited_at ? r.edited_at.toISOString() : null,
        deleted: r.deleted,
        replyToMessageId: r.reply_to_message_id,
        reactions: [] as ReactionGroup[],
      }));

      // Подтягиваем реакции для всех сообщений одним запросом
      if (messages.length > 0) {
        const msgIds = messages.map((m) => m.messageId);
        const rxRes = await pool.query(
          `SELECT message_id, emoji, array_agg(user_id) AS users
           FROM message_reactions
           WHERE message_id = ANY($1)
           GROUP BY message_id, emoji
           ORDER BY message_id, count(*) DESC, emoji`,
          [msgIds],
        );
        const rxMap = new Map<string, ReactionGroup[]>();
        for (const r of rxRes.rows) {
          const mid = r.message_id as string;
          if (!rxMap.has(mid)) rxMap.set(mid, []);
          rxMap.get(mid)!.push({
            emoji: r.emoji as string,
            users: r.users as string[],
            count: (r.users as string[]).length,
          });
        }
        for (const m of messages) {
          m.reactions = rxMap.get(m.messageId) ?? [];
        }
      }

      const nextBefore =
        hasMore && slice.length > 0 ? slice[slice.length - 1].message_id : null;

      return reply.send({ messages, hasMore, nextBefore });
    },
  );

  app.patch(
    '/messages/:messageId',
    { preHandler: authenticate },
    async (req, reply) => {
      const userId = req.user!.userId;
      const { messageId } = req.params as { messageId: string };
      const { ciphertext } = (req.body ?? {}) as { ciphertext?: string };
      if (!ciphertext) {
        return reply.code(400).send({ error: 'missing ciphertext' });
      }

      const msg = await pool.query(
        'SELECT chat_id, sender_id, deleted FROM messages WHERE message_id = $1',
        [messageId],
      );
      if (msg.rowCount === 0) {
        return reply.code(404).send({ error: 'not found' });
      }
      const row = msg.rows[0];
      if (row.sender_id !== userId) {
        return reply.code(403).send({ error: 'forbidden' });
      }
      if (row.deleted) {
        return reply.code(400).send({ error: 'message deleted' });
      }

      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const upd = await client.query(
          'UPDATE messages SET ciphertext = $1, edited_at = now() WHERE message_id = $2 RETURNING edited_at',
          [Buffer.from(ciphertext, 'base64'), messageId],
        );
        const editedAt: Date = upd.rows[0].edited_at;
        await emitToMembers(client, row.chat_id, 'message.edited', {
          messageId,
          ciphertext,
          editedAt: editedAt.toISOString(),
        });
        await client.query('COMMIT');
        return reply.send({ messageId, editedAt: editedAt.toISOString() });
      } catch (err) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw err;
      } finally {
        client.release();
      }
    },
  );

  app.delete(
    '/messages/:messageId',
    { preHandler: authenticate },
    async (req, reply) => {
      const userId = req.user!.userId;
      const { messageId } = req.params as { messageId: string };

      const msg = await pool.query(
        `SELECT m.chat_id, m.sender_id, m.deleted, c.type, c.created_by
         FROM messages m JOIN chats c ON c.chat_id = m.chat_id
         WHERE m.message_id = $1`,
        [messageId],
      );
      if (msg.rowCount === 0) {
        return reply.code(404).send({ error: 'not found' });
      }
      const row = msg.rows[0];
      // Удаление разрешено: автору сообщения ИЛИ владельцу группы
      const isOwner = row.type === 'group' && row.created_by === userId;
      if (row.sender_id !== userId && !isOwner) {
        return reply.code(403).send({ error: 'forbidden' });
      }
      if (row.deleted) {
        return reply.send({ messageId }); // идемпотентно
      }

      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        // содержимое стирается, метка deleted ставится
        await client.query(
          "UPDATE messages SET deleted = true, ciphertext = ''::bytea WHERE message_id = $1",
          [messageId],
        );
        await emitToMembers(client, row.chat_id, 'message.deleted', {
          messageId,
        });
        await client.query('COMMIT');
        return reply.send({ messageId });
      } catch (err) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw err;
      } finally {
        client.release();
      }
    },
  );

  app.post(
    '/chats/:chatId/read',
    { preHandler: authenticate },
    async (req, reply) => {
      const userId = req.user!.userId;
      const { chatId } = req.params as { chatId: string };
      const { upToMessageId } = (req.body ?? {}) as { upToMessageId?: string };
      if (!upToMessageId || !/^\d+$/.test(upToMessageId)) {
        return reply.code(400).send({ error: 'missing upToMessageId' });
      }
      if (!(await isMember(chatId, userId))) {
        return reply.code(404).send({ error: 'not found' });
      }
      await markRead(userId, chatId, upToMessageId);
      return reply.send({ ok: true });
    },
  );
}
