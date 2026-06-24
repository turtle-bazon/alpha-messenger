import { pool } from './db';

// Пуш — ортогональный транспорту канал «разбудить клиента», без содержимого
// сообщения (см. doc/architecture.md). Получив wake-up, клиент переоткрывает WS
// и досинхронизируется через hello/lastSeq — сам пуш ничего из outbox не несёт.
//
// v1: реальной отправки в FCM/UnifiedPush ещё нет — это заглушка, которая
// находит каналы получателя и логирует намерение. Точка интеграции с провайдерами
// инкапсулирована здесь; контракт вызова (sendWakeUp по userId) меняться не будет.
export async function sendWakeUp(userId: string): Promise<number> {
  const { rows } = await pool.query(
    `SELECT ps.provider, ps.endpoint
       FROM push_subscriptions ps
       JOIN devices d ON d.device_id = ps.device_id
      WHERE d.user_id = $1`,
    [userId],
  );
  for (const r of rows) {
    // TODO: реальная доставка wake-up провайдеру (FCM / UnifiedPush).
    console.log(`push wake-up (stub) -> ${r.provider}:${r.endpoint}`);
  }
  return rows.length;
}
