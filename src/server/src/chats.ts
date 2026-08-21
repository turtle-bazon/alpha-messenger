import { Pool, PoolClient } from 'pg';

type Db = Pool | PoolClient;

export interface ChatView {
  chatId: string;
  type: 'direct' | 'group';
  title: string | null;
  description: string;
  createdBy: string | null;
  username: string | null;
  role: string;
  subscriberCount: number;
  pinnedMessageId: string | null;
  participants: { userId: string; username: string; lastActiveAt?: string }[];
  lastMessage: {
    messageId: string;
    senderId: string;
    ciphertext: string;
    ts: string;
  } | null;
  unreadCount: number;
  unreadMentions: number;
  peerReadUpTo: string;
  updatedAt: string;
}

// Single chat view for POST /chats, GET /chats, GET /chats/{id}.
// Assumes userId is a chat member.
export async function loadChat(
  db: Db,
  chatId: string,
  userId: string,
): Promise<ChatView | null> {
  const chat = await db.query(
    'SELECT chat_id, type, title, description, created_by, username, updated_at, pinned_message_id FROM chats WHERE chat_id = $1',
    [chatId],
  );
  if (chat.rowCount === 0) return null;
  const row = chat.rows[0];

  const members = await db.query(
    `SELECT a.user_id, a.username, a.last_active_at, m.role FROM chat_members m
     JOIN accounts a ON a.user_id = m.user_id
     WHERE m.chat_id = $1 ORDER BY a.username`,
    [chatId],
  );

  // Current user's role in the chat.
  const myRole = await db.query(
    'SELECT role FROM chat_members WHERE chat_id = $1 AND user_id = $2',
    [chatId, userId],
  );
  const role: string = myRole.rows[0]?.role ?? 'member';

  // Subscriber/participant count.
  const subCount = await db.query(
    'SELECT count(*)::int AS c FROM chat_members WHERE chat_id = $1',
    [chatId],
  );

  const lastRead = await db.query(
    'SELECT last_read_message_id FROM chat_members WHERE chat_id = $1 AND user_id = $2',
    [chatId, userId],
  );
  const lastReadId: string | null =
    lastRead.rows[0]?.last_read_message_id ?? null;

  const lastMsg = await db.query(
    `SELECT message_id, sender_id, ciphertext, created_at FROM messages
     WHERE chat_id = $1 AND deleted = false
     ORDER BY message_id DESC LIMIT 1`,
    [chatId],
  );

  const unread = await db.query(
    `SELECT count(*)::int AS c FROM messages
     WHERE chat_id = $1 AND deleted = false AND sender_id <> $2
       AND message_id > COALESCE($3::bigint, 0)`,
    [chatId, userId, lastReadId],
  );

  // Unread replies to my messages: messages replying to my messages
  // that I haven't read yet.
  const unreadMentionsRes = await db.query(
    `SELECT count(*)::int AS c FROM messages m
     WHERE m.chat_id = $1 AND m.deleted = false AND m.sender_id <> $2
       AND m.message_id > COALESCE($3::bigint, 0)
       AND m.reply_to_message_id IS NOT NULL
       AND EXISTS (
         SELECT 1 FROM messages ref
         WHERE ref.message_id = m.reply_to_message_id AND ref.sender_id = $2
       )`,
    [chatId, userId, lastReadId],
  );

  // Up to which message_id others have read us (take the max — for direct chats
  // that's the peer; in a group one reader suffices).
  const peerRead = await db.query(
    `SELECT COALESCE(MAX(last_read_message_id), 0)::text AS m
       FROM chat_members WHERE chat_id = $1 AND user_id <> $2`,
    [chatId, userId],
  );

  const lm = lastMsg.rows[0];
  return {
    chatId: row.chat_id,
    type: row.type,
    title: row.title,
    description: row.description ?? '',
    createdBy: row.created_by,
    username: row.username ?? null,
    role,
    subscriberCount: subCount.rows[0].c,
    pinnedMessageId: row.pinned_message_id != null ? String(row.pinned_message_id) : null,
    participants: members.rows.map((m) => ({
      userId: m.user_id,
      username: m.username,
      role: m.role,
      ...(m.last_active_at ? { lastActiveAt: m.last_active_at.toISOString() } : {}),
    })),
    lastMessage: lm
      ? {
          messageId: lm.message_id,
          senderId: lm.sender_id,
          ciphertext: (lm.ciphertext as Buffer).toString('base64'),
          ts: lm.created_at.toISOString(),
        }
      : null,
    unreadCount: unread.rows[0].c,
    unreadMentions: unreadMentionsRes.rows[0].c,
    peerReadUpTo: peerRead.rows[0].m,
    updatedAt: row.updated_at.toISOString(),
  };
}
