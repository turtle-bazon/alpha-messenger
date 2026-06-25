import { Pool, PoolClient } from 'pg';

type Db = Pool | PoolClient;

export interface ChatView {
  chatId: string;
  type: 'direct' | 'group';
  title: string | null;
  createdBy: string | null;
  participants: { userId: string; username: string }[];
  lastMessage: {
    messageId: string;
    senderId: string;
    ciphertext: string;
    ts: string;
  } | null;
  unreadCount: number;
  // Максимальный маркер прочтения среди ДРУГИХ участников — до какого message_id
  // нас «прочитали». Нужен для устойчивого статуса ✓✓ (не только из live-событий).
  peerReadUpTo: string;
  updatedAt: string;
}

// Единый вид чата для POST /chats, GET /chats, GET /chats/{id}.
// Предполагается, что userId — участник чата.
export async function loadChat(
  db: Db,
  chatId: string,
  userId: string,
): Promise<ChatView | null> {
  const chat = await db.query(
    'SELECT chat_id, type, title, created_by, updated_at FROM chats WHERE chat_id = $1',
    [chatId],
  );
  if (chat.rowCount === 0) return null;
  const row = chat.rows[0];

  const members = await db.query(
    `SELECT a.user_id, a.username FROM chat_members m
     JOIN accounts a ON a.user_id = m.user_id
     WHERE m.chat_id = $1 ORDER BY a.username`,
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

  // До какого message_id нас прочитали другие участники (берём максимум —
  // для direct это собеседник, для группы достаточно одного прочитавшего).
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
    createdBy: row.created_by,
    participants: members.rows.map((m) => ({
      userId: m.user_id,
      username: m.username,
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
    peerReadUpTo: peerRead.rows[0].m,
    updatedAt: row.updated_at.toISOString(),
  };
}
