import { FastifyInstance, FastifyReply } from 'fastify';
import { pool } from '../db';
import { authenticate } from '../auth';
import { emitEvent } from '../events';
import { loadChat } from '../chats';
import { emitToMembers, getMemberIds, getLastActiveMap } from '../chat-helpers';
import { isOnline } from '../ws';

interface CreateChatBody {
  type?: string;
  username?: string;
  title?: string;
  members?: unknown;
}

async function createDirect(
  reply: FastifyReply,
  userId: string,
  username: string | undefined,
): Promise<FastifyReply> {
  if (!username) return reply.code(400).send({ error: 'missing username' });

  const target = await pool.query(
    'SELECT user_id FROM accounts WHERE username = $1',
    [username],
  );
  if (target.rowCount === 0) {
    return reply.code(404).send({ error: 'user not found' });
  }
  const otherId: string = target.rows[0].user_id;
  if (otherId === userId) {
    return reply.code(400).send({ error: 'cannot create direct chat with self' });
  }

  // дедупликация: если direct-чат с обоими участниками уже есть — вернуть его
  const existing = await pool.query(
    `SELECT c.chat_id FROM chats c
     JOIN chat_members a ON a.chat_id = c.chat_id AND a.user_id = $1
     JOIN chat_members b ON b.chat_id = c.chat_id AND b.user_id = $2
     WHERE c.type = 'direct' LIMIT 1`,
    [userId, otherId],
  );
  if (existing.rowCount! > 0) {
    const chat = await loadChat(pool, existing.rows[0].chat_id, userId);
    return reply.code(200).send(chat);
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const c = await client.query(
      "INSERT INTO chats(type, created_by) VALUES ('direct', $1) RETURNING chat_id",
      [userId],
    );
    const chatId: string = c.rows[0].chat_id;
    await client.query(
      'INSERT INTO chat_members(chat_id, user_id) VALUES ($1, $2), ($1, $3)',
      [chatId, userId, otherId],
    );
    await emitEvent(client, userId, 'chat.created', { chatId }, chatId);
    await emitEvent(client, otherId, 'chat.created', { chatId }, chatId);
    await client.query('COMMIT');
    const chat = await loadChat(pool, chatId, userId);
    return reply.code(201).send(chat);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

async function createGroup(
  reply: FastifyReply,
  userId: string,
  title: string | undefined,
  members: unknown,
): Promise<FastifyReply> {
  if (!Array.isArray(members)) {
    return reply.code(400).send({ error: 'members must be an array' });
  }
  const usernames = [...new Set(members)].filter(
    (u): u is string => typeof u === 'string',
  );

  let memberIds: string[] = [];
  if (usernames.length > 0) {
    const res = await pool.query(
      'SELECT user_id FROM accounts WHERE username = ANY($1)',
      [usernames],
    );
    if (res.rowCount !== usernames.length) {
      return reply.code(400).send({ error: 'unknown member' });
    }
    memberIds = res.rows.map((r) => r.user_id);
  }
  const allIds = [...new Set([userId, ...memberIds])];

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const c = await client.query(
      "INSERT INTO chats(type, title, created_by) VALUES ('group', $1, $2) RETURNING chat_id",
      [title ?? null, userId],
    );
    const chatId: string = c.rows[0].chat_id;
    for (const id of allIds) {
      await client.query(
        'INSERT INTO chat_members(chat_id, user_id) VALUES ($1, $2)',
        [chatId, id],
      );
      await emitEvent(client, id, 'chat.created', { chatId }, chatId);
    }
    await client.query('COMMIT');
    const chat = await loadChat(pool, chatId, userId);
    return reply.code(201).send(chat);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

export async function chatRoutes(app: FastifyInstance): Promise<void> {
  app.get('/chats', { preHandler: authenticate }, async (req) => {
    const userId = req.user!.userId;
    const list = await pool.query(
      `SELECT c.chat_id FROM chats c
       JOIN chat_members m ON m.chat_id = c.chat_id AND m.user_id = $1
       ORDER BY c.updated_at DESC`,
      [userId],
    );
    const chats = [];
    for (const r of list.rows) {
      chats.push(await loadChat(pool, r.chat_id, userId));
    }
    return { chats };
  });

  app.get('/chats/:chatId', { preHandler: authenticate }, async (req, reply) => {
    const userId = req.user!.userId;
    const { chatId } = req.params as { chatId: string };
    const member = await pool.query(
      'SELECT 1 FROM chat_members WHERE chat_id = $1 AND user_id = $2',
      [chatId, userId],
    );
    if (member.rowCount === 0) {
      return reply.code(404).send({ error: 'not found' });
    }
    return loadChat(pool, chatId, userId);
  });

  // Список участников чата с признаком онлайн и указанием создателя.
  // Снимок онлайна на момент запроса; живые изменения — события presence из /ws.
  app.get(
    '/chats/:chatId/members',
    { preHandler: authenticate },
    async (req, reply) => {
      const userId = req.user!.userId;
      const { chatId } = req.params as { chatId: string };
      const chat = await pool.query(
        'SELECT created_by FROM chats WHERE chat_id = $1',
        [chatId],
      );
      if (chat.rowCount === 0) {
        return reply.code(404).send({ error: 'not found' });
      }
      const members = await pool.query(
        `SELECT a.user_id, a.username FROM chat_members m
         JOIN accounts a ON a.user_id = m.user_id
         WHERE m.chat_id = $1 ORDER BY a.username`,
        [chatId],
      );
      if (!members.rows.some((m) => m.user_id === userId)) {
        return reply.code(404).send({ error: 'not found' });
      }
      const memberIds = members.rows.map((m) => m.user_id as string);
      const lastActiveMap = await getLastActiveMap(memberIds);
      const now = Date.now();
      const AWAY_MS = 5 * 60 * 1000;
      return {
        createdBy: chat.rows[0].created_by as string | null,
        members: members.rows.map((m) => {
          const uid = m.user_id as string;
          const online = isOnline(uid);
          const lastActive = lastActiveMap.get(uid) ?? null;
          const away = online && lastActive && (now - lastActive.getTime()) > AWAY_MS;
          return {
            userId: uid,
            username: m.username,
            online,
            away: !!away,
            ...(lastActive ? { lastActiveAt: lastActive.toISOString() } : {}),
          };
        }),
      };
    },
  );

  // Удаление участника из группы. Право — только у создателя чата; нельзя
  // удалить самого создателя и не-группу. Событие chat.member_removed идёт
  // оставшимся участникам и самому удалённому (он убирает чат из списка).
  app.delete(
    '/chats/:chatId/members/:userId',
    { preHandler: authenticate },
    async (req, reply) => {
      const callerId = req.user!.userId;
      const { chatId, userId: targetId } = req.params as {
        chatId: string;
        userId: string;
      };
      const chat = await pool.query(
        'SELECT type, created_by FROM chats WHERE chat_id = $1',
        [chatId],
      );
      if (chat.rowCount === 0) {
        return reply.code(404).send({ error: 'not found' });
      }
      const { type, created_by: createdBy } = chat.rows[0];
      if (createdBy !== callerId) {
        return reply.code(403).send({ error: 'not chat owner' });
      }
      if (type !== 'group') {
        return reply.code(400).send({ error: 'not a group' });
      }
      if (targetId === createdBy) {
        return reply.code(400).send({ error: 'cannot remove owner' });
      }
      const member = await pool.query(
        'SELECT 1 FROM chat_members WHERE chat_id = $1 AND user_id = $2',
        [chatId, targetId],
      );
      if (member.rowCount === 0) {
        return reply.code(404).send({ error: 'not a member' });
      }

      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(
          'DELETE FROM chat_members WHERE chat_id = $1 AND user_id = $2',
          [chatId, targetId],
        );
        // оставшимся — обновить список участников; всем им emitToMembers
        await emitToMembers(client, chatId, 'chat.member_removed', {
          chatId,
          userId: targetId,
        });
        // и самому удалённому — чтобы он убрал чат из своего списка
        await emitEvent(
          client,
          targetId,
          'chat.member_removed',
          { chatId, userId: targetId },
          chatId,
        );
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw err;
      } finally {
        client.release();
      }
      return reply.code(200).send({ chatId, userId: targetId });
    },
  );

  // Добавление участника в группу. Право — только у создателя чата; добавлять
  // можно лишь в группу и лишь того, кого ещё нет в чате. Новому участнику идёт
  // chat.created (он подтягивает чат в список), уже состоящим — chat.member_added
  // (обновляют состав/счётчик участников).
  app.post(
    '/chats/:chatId/members',
    { preHandler: authenticate },
    async (req, reply) => {
      const callerId = req.user!.userId;
      const { chatId } = req.params as { chatId: string };
      const { username } = (req.body ?? {}) as { username?: string };
      if (!username) {
        return reply.code(400).send({ error: 'missing username' });
      }
      const chat = await pool.query(
        'SELECT type, created_by FROM chats WHERE chat_id = $1',
        [chatId],
      );
      if (chat.rowCount === 0) {
        return reply.code(404).send({ error: 'not found' });
      }
      const { type, created_by: createdBy } = chat.rows[0];
      if (createdBy !== callerId) {
        return reply.code(403).send({ error: 'not chat owner' });
      }
      if (type !== 'group') {
        return reply.code(400).send({ error: 'not a group' });
      }
      const target = await pool.query(
        'SELECT user_id FROM accounts WHERE username = $1',
        [username],
      );
      if (target.rowCount === 0) {
        return reply.code(404).send({ error: 'user not found' });
      }
      const targetId: string = target.rows[0].user_id;
      const already = await pool.query(
        'SELECT 1 FROM chat_members WHERE chat_id = $1 AND user_id = $2',
        [chatId, targetId],
      );
      if (already.rowCount! > 0) {
        return reply.code(409).send({ error: 'already a member' });
      }

      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        // Состав ДО вставки — им шлём member_added, новому — chat.created.
        const existingIds = await getMemberIds(client, chatId);
        await client.query(
          'INSERT INTO chat_members(chat_id, user_id) VALUES ($1, $2)',
          [chatId, targetId],
        );
        await emitEvent(
          client,
          targetId,
          'chat.created',
          { chatId },
          chatId,
        );
        for (const id of existingIds) {
          await emitEvent(
            client,
            id,
            'chat.member_added',
            { chatId, userId: targetId },
            chatId,
          );
        }
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw err;
      } finally {
        client.release();
      }
      return reply.code(201).send({ chatId, userId: targetId });
    },
  );

  app.post('/chats', { preHandler: authenticate }, async (req, reply) => {
    const userId = req.user!.userId;
    const body = (req.body ?? {}) as CreateChatBody;
    if (body.type === 'direct') {
      return createDirect(reply, userId, body.username);
    }
    if (body.type === 'group') {
      return createGroup(reply, userId, body.title, body.members);
    }
    return reply.code(400).send({ error: 'invalid type' });
  });
}
