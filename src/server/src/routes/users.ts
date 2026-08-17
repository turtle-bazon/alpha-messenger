import { FastifyInstance } from 'fastify';
import { pool } from '../db';
import { authenticate } from '../auth';

export async function userRoutes(app: FastifyInstance): Promise<void> {
  // GET /users?search= — поиск пользователей по username (начало совпадения).
  app.get('/users', { preHandler: authenticate }, async (req, reply) => {
    const { search } = req.query as { search?: string };
    if (!search || search.trim().length === 0) {
      return reply.code(400).send({ error: 'search is required' });
    }
    const pattern = search.trim().toLowerCase() + '%';
    const res = await pool.query(
      `SELECT user_id, username, created_at, last_active_at
       FROM accounts
       WHERE lower(username) LIKE $1
       ORDER BY lower(username)
       LIMIT 20`,
      [pattern],
    );
    return {
      users: res.rows.map((r) => ({
        userId: r.user_id,
        username: r.username,
        createdAt: r.created_at,
        lastActiveAt: r.last_active_at,
      })),
    };
  });

  // GET /users/:userId — публичный профиль пользователя.
  app.get('/users/:userId', { preHandler: authenticate }, async (req, reply) => {
    const { userId } = req.params as { userId: string };
    const res = await pool.query(
      `SELECT user_id, username, created_at, last_active_at
       FROM accounts WHERE user_id = $1`,
      [userId],
    );
    if (res.rows.length === 0) {
      return reply.code(404).send({ error: 'User not found' });
    }
    const r = res.rows[0];
    return {
      userId: r.user_id,
      username: r.username,
      createdAt: r.created_at,
      lastActiveAt: r.last_active_at,
    };
  });

  // --- Заметки (личные, видны только автору) ---

  // GET /me/notes/:targetId — получить свою заметку о пользователе.
  app.get('/me/notes/:targetId', { preHandler: authenticate }, async (req, reply) => {
    const authorId = req.user!.userId;
    const { targetId } = req.params as { targetId: string };
    const res = await pool.query(
      `SELECT note, created_at, updated_at
       FROM user_notes
       WHERE author_id = $1 AND target_id = $2`,
      [authorId, targetId],
    );
    if (res.rows.length === 0) {
      return { note: null };
    }
    const r = res.rows[0];
    return { note: { text: r.note, createdAt: r.created_at, updatedAt: r.updated_at } };
  });

  // PUT /me/notes/:targetId — создать или обновить заметку.
  app.put('/me/notes/:targetId', { preHandler: authenticate }, async (req) => {
    const authorId = req.user!.userId;
    const { targetId } = req.params as { targetId: string };
    const { text } = (req.body ?? {}) as { text?: string };
    const note = (text ?? '').trim();

    if (note === '') {
      // Пустая заметка = удаление.
      await pool.query(
        `DELETE FROM user_notes WHERE author_id = $1 AND target_id = $2`,
        [authorId, targetId],
      );
      return { note: null };
    }

    const res = await pool.query(
      `INSERT INTO user_notes (author_id, target_id, note, created_at, updated_at)
       VALUES ($1, $2, $3, now(), now())
       ON CONFLICT (author_id, target_id)
       DO UPDATE SET note = EXCLUDED.note, updated_at = now()
       RETURNING created_at, updated_at`,
      [authorId, targetId, note],
    );
    const r = res.rows[0];
    return { note: { text: note, createdAt: r.created_at, updatedAt: r.updated_at } };
  });

  // DELETE /me/notes/:targetId — удалить заметку.
  app.delete('/me/notes/:targetId', { preHandler: authenticate }, async (req) => {
    const authorId = req.user!.userId;
    const { targetId } = req.params as { targetId: string };
    await pool.query(
      `DELETE FROM user_notes WHERE author_id = $1 AND target_id = $2`,
      [authorId, targetId],
    );
    return { ok: true };
  });
}
