import { FastifyInstance, FastifyReply } from 'fastify';
import { pool } from '../db';
import { authenticate } from '../auth';
import { emitEvent } from '../events';
import { loadChat } from '../chats';
import { emitToMembers, getMemberIds, getLastActiveMap, isMember } from '../chat-helpers';
import { isOnline } from '../ws';

interface CreateChatBody {
  type?: string;
  username?: string;
  title?: string;
  members?: unknown;
  channelUsername?: string;
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

  // Advisory lock on the canonical member pair (LEAST, GREATEST)
  // protects against a race: two parallel requests won't create a duplicate.
  const lockKey = userId < otherId
    ? Buffer.from(userId + otherId).readInt32BE(0)
    : Buffer.from(otherId + userId).readInt32BE(0);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock($1)', [lockKey]);

    // deduplication: if a direct chat with both members already exists, return it
    const existing = await client.query(
      `SELECT c.chat_id FROM chats c
       JOIN chat_members a ON a.chat_id = c.chat_id AND a.user_id = $1
       JOIN chat_members b ON b.chat_id = c.chat_id AND b.user_id = $2
       WHERE c.type = 'direct' LIMIT 1`,
      [userId, otherId],
    );
    if (existing.rowCount! > 0) {
      await client.query('COMMIT');
      const chat = await loadChat(pool, existing.rows[0].chat_id, userId);
      return reply.code(200).send(chat);
    }

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
  channelUsername?: string,
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

  // Validate the channel handle if provided.
  if (channelUsername !== undefined) {
    if (!/^[a-zA-Z0-9_]{5,32}$/.test(channelUsername)) {
      return reply.code(400).send({ error: 'invalid channel username: 5-32 chars, a-z, 0-9, _' });
    }
    const exists = await pool.query(
      'SELECT 1 FROM chats WHERE username = $1',
      [channelUsername],
    );
    if (exists.rowCount! > 0) {
      return reply.code(409).send({ error: 'channel username taken' });
    }
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const c = await client.query(
      `INSERT INTO chats(type, title, created_by, username)
       VALUES ('group', $1, $2, $3) RETURNING chat_id`,
      [title ?? null, userId, channelUsername ?? null],
    );
    const chatId: string = c.rows[0].chat_id;
    for (const id of allIds) {
      const role = id === userId ? 'owner' : (channelUsername ? 'subscriber' : 'member');
      await client.query(
        'INSERT INTO chat_members(chat_id, user_id, role) VALUES ($1, $2, $3)',
        [chatId, id, role],
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
    // A non-member can view a public channel (for the "Subscribe" button).
    if (member.rowCount === 0) {
      const ch = await pool.query(
        'SELECT username FROM chats WHERE chat_id = $1',
        [chatId],
      );
      if (ch.rowCount === 0 || !ch.rows[0].username) {
        return reply.code(404).send({ error: 'not found' });
      }
      // Non-members get minimal channel info.
      const full = await loadChat(pool, chatId, userId);
      if (!full) return reply.code(404).send({ error: 'not found' });
      return { ...full, role: 'non_member' };
    }
    return loadChat(pool, chatId, userId);
  });

  // Chat member list with online status and creator indication.
  // Online snapshot at request time; live changes come as presence events from /ws.
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

  // Remove a member from a group. Only the chat creator may do this; cannot
  // remove the creator or from non-groups. The chat.member_removed event goes
  // to remaining members and to the removed one (so they drop the chat).
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
        // remaining members — refresh their member list; emitToMembers covers them
        await emitToMembers(client, chatId, 'chat.member_removed', {
          chatId,
          userId: targetId,
        });
        // and to the removed one, so they drop the chat from their list
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

  // Add a member to a group. Only the chat creator may do this; only into a
  // group and only someone not yet in the chat. The new member gets chat.created
  // (pulls the chat into their list), existing members get chat.member_added
  // (refresh roster/member count).
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
        'SELECT type, created_by, username FROM chats WHERE chat_id = $1',
        [chatId],
      );
      if (chat.rowCount === 0) {
        return reply.code(404).send({ error: 'not found' });
      }
      const { type, created_by: createdBy, username: chatUsername } = chat.rows[0];
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
        // Roster BEFORE the insert: existing members get member_added, the new one gets chat.created.
        const existingIds = await getMemberIds(client, chatId);
        await client.query(
          'INSERT INTO chat_members(chat_id, user_id, role) VALUES ($1, $2, $3)',
          [chatId, targetId, chatUsername ? 'subscriber' : 'member'],
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

  // PUT/DELETE /chats/:chatId/pin — pin/unpin a message in the chat (#86).
  // Any member may pin (direct: both sides, group/channel: admins+owner for v1
  // keep it simple — any member, same as Telegram direct chats).
  app.put('/chats/:chatId/pin', { preHandler: authenticate }, async (req, reply) => {
    const userId = req.user!.userId;
    const { chatId } = req.params as { chatId: string };
    const { messageId } = (req.body ?? {}) as { messageId?: string };
    if (!messageId || !/^\d+$/.test(messageId)) {
      return reply.code(400).send({ error: 'invalid messageId' });
    }
    if (!(await isMember(chatId, userId))) {
      return reply.code(404).send({ error: 'not found' });
    }
    // The message must belong to this chat and not be deleted.
    const msg = await pool.query(
      'SELECT 1 FROM messages WHERE message_id = $1::bigint AND chat_id = $2 AND deleted = false',
      [messageId, chatId],
    );
    if (msg.rowCount === 0) {
      return reply.code(404).send({ error: 'message not found' });
    }
    await pool.query(
      'UPDATE chats SET pinned_message_id = $1::bigint WHERE chat_id = $2',
      [messageId, chatId],
    );
    await emitToMembers(pool, chatId, 'chat.pinned', {
      chatId,
      pinnedMessageId: messageId,
      byUserId: userId,
    });
    return loadChat(pool, chatId, userId);
  });

  app.delete('/chats/:chatId/pin', { preHandler: authenticate }, async (req, reply) => {
    const userId = req.user!.userId;
    const { chatId } = req.params as { chatId: string };
    if (!(await isMember(chatId, userId))) {
      return reply.code(404).send({ error: 'not found' });
    }
    await pool.query(
      'UPDATE chats SET pinned_message_id = NULL WHERE chat_id = $1',
      [chatId],
    );
    await emitToMembers(pool, chatId, 'chat.pinned', {
      chatId,
      pinnedMessageId: null,
      byUserId: userId,
    });
    return loadChat(pool, chatId, userId);
  });

  // PATCH /chats/:chatId — update title/description (owner only).
  app.patch('/chats/:chatId', { preHandler: authenticate }, async (req, reply) => {
    const callerId = req.user!.userId;
    const { chatId } = req.params as { chatId: string };
    const { title, description } = (req.body ?? {}) as {
      title?: string;
      description?: string;
    };
    const chat = await pool.query(
      'SELECT type, created_by FROM chats WHERE chat_id = $1',
      [chatId],
    );
    if (chat.rowCount === 0) {
      return reply.code(404).send({ error: 'not found' });
    }
    const { type, created_by: createdBy } = chat.rows[0];
    if (type !== 'group') {
      return reply.code(400).send({ error: 'not a group' });
    }
    if (createdBy !== callerId) {
      return reply.code(403).send({ error: 'not chat owner' });
    }
    const sets: string[] = [];
    const vals: unknown[] = [];
    let idx = 1;
    if (title !== undefined) {
      sets.push(`title = $${idx++}`);
      vals.push(title);
    }
    if (description !== undefined) {
      sets.push(`description = $${idx++}`);
      vals.push(description);
    }
    if (sets.length === 0) {
      return reply.code(400).send({ error: 'nothing to update' });
    }
    vals.push(chatId);
    await pool.query(
      `UPDATE chats SET ${sets.join(', ')}, updated_at = now() WHERE chat_id = $${idx}`,
      vals,
    );
    return loadChat(pool, chatId, callerId);
  });

  app.post('/chats', { preHandler: authenticate }, async (req, reply) => {
    const userId = req.user!.userId;
    const body = (req.body ?? {}) as CreateChatBody;
    if (body.type === 'direct') {
      return createDirect(reply, userId, body.username);
    }
    if (body.type === 'group') {
      return createGroup(reply, userId, body.title, body.members, body.channelUsername);
    }
    return reply.code(400).send({ error: 'invalid type' });
  });

  // Search public channels by handle or title.
  app.get('/chats/search', { preHandler: authenticate }, async (req) => {
    const { q } = req.query as { q?: string };
    if (!q || q.trim().length === 0) {
      return { chats: [] };
    }
    const res = await pool.query(
      `SELECT c.chat_id, c.title, c.username, c.description,
              (SELECT count(*)::int FROM chat_members WHERE chat_id = c.chat_id) AS subscriber_count
       FROM chats c
       WHERE c.username IS NOT NULL
         AND (c.username ILIKE '%' || $1 || '%' OR c.title ILIKE '%' || $1 || '%')
       ORDER BY subscriber_count DESC
       LIMIT 20`,
      [q.trim()],
    );
    return {
      chats: res.rows.map((r) => ({
        chatId: r.chat_id,
        title: r.title,
        username: r.username,
        description: r.description ?? '',
        subscriberCount: r.subscriber_count,
      })),
    };
  });

  // Subscribe to a channel (by chatId or handle).
  app.post('/chats/:chatId/subscribe', { preHandler: authenticate }, async (req, reply) => {
    const userId = req.user!.userId;
    const { chatId } = req.params as { chatId: string };

    const chat = await pool.query(
      'SELECT type, username FROM chats WHERE chat_id = $1',
      [chatId],
    );
    if (chat.rowCount === 0) {
      return reply.code(404).send({ error: 'not found' });
    }
    if (chat.rows[0].type !== 'group' || !chat.rows[0].username) {
      return reply.code(400).send({ error: 'not a channel' });
    }

    const existing = await pool.query(
      'SELECT 1 FROM chat_members WHERE chat_id = $1 AND user_id = $2',
      [chatId, userId],
    );
    if (existing.rowCount! > 0) {
      return reply.code(200).send({ ok: true, already: true });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        'INSERT INTO chat_members(chat_id, user_id, role) VALUES ($1, $2, $3)',
        [chatId, userId, 'subscriber'],
      );
      await emitEvent(client, userId, 'chat.created', { chatId }, chatId);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
    return reply.code(201).send({ ok: true });
  });

  // Unsubscribe from a channel.
  app.delete('/chats/:chatId/subscribe', { preHandler: authenticate }, async (req, reply) => {
    const userId = req.user!.userId;
    const { chatId } = req.params as { chatId: string };

    const chat = await pool.query(
      'SELECT type, username, created_by FROM chats WHERE chat_id = $1',
      [chatId],
    );
    if (chat.rowCount === 0) {
      return reply.code(404).send({ error: 'not found' });
    }
    if (!chat.rows[0].username) {
      return reply.code(400).send({ error: 'not a channel' });
    }
    if (chat.rows[0].created_by === userId) {
      return reply.code(400).send({ error: 'owner cannot unsubscribe' });
    }

    await pool.query(
      'DELETE FROM chat_members WHERE chat_id = $1 AND user_id = $2',
      [chatId, userId],
    );
    return reply.send({ ok: true });
  });
}
