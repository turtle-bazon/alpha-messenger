import { Pool, PoolClient } from 'pg';

// Кладёт событие в outbox (таблица events). Доставкой по WS занимается /ws (см. план).
// db — пул или клиент в открытой транзакции.
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
  // будит WS-доставку для получателя; в транзакции доставится на commit
  await db.query("SELECT pg_notify('alpha_events', $1)", [userId]);
}
