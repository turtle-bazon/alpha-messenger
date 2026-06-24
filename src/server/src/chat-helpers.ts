import { Pool, PoolClient } from 'pg';
import { pool } from './db';
import { emitEvent } from './events';

type Db = Pool | PoolClient;

export async function isMember(
  chatId: string,
  userId: string,
): Promise<boolean> {
  const r = await pool.query(
    'SELECT 1 FROM chat_members WHERE chat_id = $1 AND user_id = $2',
    [chatId, userId],
  );
  return r.rowCount! > 0;
}

export async function getMemberIds(db: Db, chatId: string): Promise<string[]> {
  const r = await db.query(
    'SELECT user_id FROM chat_members WHERE chat_id = $1',
    [chatId],
  );
  return r.rows.map((x) => x.user_id);
}

export async function emitToMembers(
  db: Db,
  chatId: string,
  type: string,
  payload: Record<string, unknown>,
): Promise<void> {
  for (const id of await getMemberIds(db, chatId)) {
    await emitEvent(db, id, type, payload, chatId);
  }
}

// Двигает маркер прочтения вперёд и эмитит message.read. Общая логика для
// REST POST /chats/{id}/read и WS-сообщения read.
export async function markRead(
  userId: string,
  chatId: string,
  upToMessageId: string,
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `UPDATE chat_members
       SET last_read_message_id = GREATEST(COALESCE(last_read_message_id, 0), $3::bigint)
       WHERE chat_id = $1 AND user_id = $2`,
      [chatId, userId, upToMessageId],
    );
    await emitToMembers(client, chatId, 'message.read', {
      userId,
      upToMessageId,
    });
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}
