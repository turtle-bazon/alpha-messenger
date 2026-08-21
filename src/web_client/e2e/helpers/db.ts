import { randomBytes } from 'node:crypto';
import { Client } from 'pg';

// Сидинг тестовых данных напрямую в БД стека (порт опубликован на 127.0.0.1).
// Это инфраструктура тестов, а не клиентский код: инвайт-коды в проде создаёт
// серверный скрипт `npm run invite`, здесь же делаем то же минимальным INSERT-ом.
const DATABASE_URL =
  process.env.E2E_DATABASE_URL ?? 'postgres://alpha:alpha@localhost:5432/alpha';

export async function createInvite(): Promise<string> {
  const code = randomBytes(12).toString('base64url');
  const client = new Client({ connectionString: DATABASE_URL });
  await client.connect();
  try {
    await client.query('INSERT INTO invites(code) VALUES ($1)', [code]);
  } finally {
    await client.end();
  }
  return code;
}

// Удаляет все сессии пользователя — имитация потери сессии на сервере
// (сброс/обновление БД), для проверки автоматического разлогина (#88).
export async function deleteSessions(username: string): Promise<void> {
  const client = new Client({ connectionString: DATABASE_URL });
  await client.connect();
  try {
    await client.query(
      `DELETE FROM sessions
       WHERE user_id = (SELECT user_id FROM accounts WHERE username = $1)`,
      [username],
    );
  } finally {
    await client.end();
  }
}
