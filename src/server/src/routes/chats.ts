import { FastifyInstance, FastifyReply } from 'fastify';
import { pool } from '../db';
import { authenticate } from '../auth';
import { emitEvent } from '../events';
import { loadChat } from '../chats';

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
      "INSERT INTO chats(type) VALUES ('direct') RETURNING chat_id",
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
      "INSERT INTO chats(type, title) VALUES ('group', $1) RETURNING chat_id",
      [title ?? null],
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
