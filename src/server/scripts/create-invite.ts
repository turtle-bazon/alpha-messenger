import { randomBytes } from 'node:crypto';
import { pool } from '../src/db';

// Генерирует одноразовый инвайт-код и печатает ссылку для регистрации.
// Запуск: npm run invite
// Опции через env: INVITE_EXPIRES_DAYS (срок жизни в днях, 0 = бессрочно),
//                  CLIENT_URL (база для ссылки).
async function main(): Promise<void> {
  const code = randomBytes(16).toString('base64url');

  const expiresDays = Number(process.env.INVITE_EXPIRES_DAYS ?? 0);
  const expiresAt =
    expiresDays > 0 ? new Date(Date.now() + expiresDays * 86_400_000) : null;

  await pool.query('INSERT INTO invites(code, expires_at) VALUES ($1, $2)', [
    code,
    expiresAt,
  ]);

  const base = process.env.CLIENT_URL ?? 'http://localhost:5173';
  console.log('Invite code:', code);
  console.log('Invite link:', `${base}/register?invite=${code}`);
  if (expiresAt) console.log('Expires at:', expiresAt.toISOString());

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
