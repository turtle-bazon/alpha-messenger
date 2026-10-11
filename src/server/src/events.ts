import { Pool, PoolClient } from 'pg';

// Puts an event into the outbox (events table). Delivery over WS is handled by /ws.
// db — pool or client inside an open transaction.
export async function emitEvent(
  db: Pool | PoolClient,
  userId: string,
  type: string,
  payload: Record<string, unknown>,
  chatId: string | null = null,
): Promise<void> {
  await db.query(
    'INSERT INTO events(user_id, type, chat_id, payload) VALUES ($1, $2, $3, $4)',
    [userId, type, chatId, JSON.stringify(payload)],
  );
  // wakes WS delivery for the recipient; inside a transaction it fires on commit
  // payload: { userId, chatId?, type, messageId?, senderId? } — chatId for per-chat
  // notifications on the client, the rest lets push decide whether this event
  // deserves a visible web push (see push.ts). Only small ids: NOTIFY is capped at 8 KB.
  await db.query("SELECT pg_notify('alpha_events', $1)", [
    JSON.stringify({
      userId,
      ...(chatId ? { chatId } : {}),
      type,
      ...(typeof payload.messageId === 'string' ? { messageId: payload.messageId } : {}),
      ...(typeof payload.senderId === 'string' ? { senderId: payload.senderId } : {}),
    }),
  ]);
}
