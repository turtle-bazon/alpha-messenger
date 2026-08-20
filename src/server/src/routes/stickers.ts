import { FastifyInstance } from 'fastify';
import { pool } from '../db';
import { authenticate } from '../auth';
import { HEX64 } from './blobs';

export async function stickerRoutes(app: FastifyInstance): Promise<void> {
  // Create a sticker pack
  app.post('/sticker-packs', { preHandler: authenticate }, async (req, reply) => {
    const userId = req.user!.userId;
    const { title } = (req.body ?? {}) as { title?: string };
    if (!title || title.trim().length === 0) {
      return reply.code(400).send({ error: 'missing title' });
    }
    if (title.length > 100) {
      return reply.code(400).send({ error: 'title too long' });
    }

    const res = await pool.query(
      'INSERT INTO sticker_packs(user_id, title) VALUES ($1, $2) RETURNING pack_id, created_at',
      [userId, title.trim()],
    );
    const pack = res.rows[0];
    return reply.code(201).send({
      packId: pack.pack_id,
      title: title.trim(),
      createdAt: pack.created_at.toISOString(),
    });
  });

  // Get my packs
  app.get('/sticker-packs', { preHandler: authenticate }, async (req, reply) => {
    const userId = req.user!.userId;
    const res = await pool.query(
      `SELECT sp.pack_id, sp.title, sp.created_at,
              (SELECT COUNT(*)::int FROM sticker_items si WHERE si.pack_id = sp.pack_id) AS item_count,
              (SELECT si2.blob_id FROM sticker_items si2 WHERE si2.pack_id = sp.pack_id ORDER BY si2.position LIMIT 1) AS cover_blob_id
       FROM sticker_packs sp
       JOIN user_sticker_packs usp ON usp.pack_id = sp.pack_id AND usp.user_id = $1
       ORDER BY sp.created_at DESC`,
      [userId],
    );
    const packs = res.rows.map((r) => ({
      packId: r.pack_id,
      title: r.title,
      itemCount: r.item_count,
      coverBlobId: r.cover_blob_id,
      createdAt: r.created_at.toISOString(),
    }));
    return reply.send({ packs });
  });

  // Install a pack (add to mine)
  app.post('/sticker-packs/:packId/install', { preHandler: authenticate }, async (req, reply) => {
    const userId = req.user!.userId;
    const { packId } = req.params as { packId: string };

    const exists = await pool.query('SELECT pack_id FROM sticker_packs WHERE pack_id = $1', [packId]);
    if (exists.rowCount === 0) {
      return reply.code(404).send({ error: 'not found' });
    }
    await pool.query(
      'INSERT INTO user_sticker_packs(user_id, pack_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [userId, packId],
    );
    return reply.send({ ok: true });
  });

  // Remove a pack from mine
  app.delete('/sticker-packs/:packId/install', { preHandler: authenticate }, async (req, reply) => {
    const userId = req.user!.userId;
    const { packId } = req.params as { packId: string };
    await pool.query(
      'DELETE FROM user_sticker_packs WHERE user_id = $1 AND pack_id = $2',
      [userId, packId],
    );
    return reply.send({ ok: true });
  });

  // Delete a pack (owner only)
  app.delete('/sticker-packs/:packId', { preHandler: authenticate }, async (req, reply) => {
    const userId = req.user!.userId;
    const { packId } = req.params as { packId: string };

    const pack = await pool.query(
      'SELECT user_id FROM sticker_packs WHERE pack_id = $1',
      [packId],
    );
    if (pack.rowCount === 0) {
      return reply.code(404).send({ error: 'not found' });
    }
    if (pack.rows[0].user_id !== userId) {
      return reply.code(403).send({ error: 'forbidden' });
    }
    await pool.query('DELETE FROM sticker_packs WHERE pack_id = $1', [packId]);
    return reply.send({ ok: true });
  });

  // Add a sticker to a pack
  app.post('/sticker-packs/:packId/items', { preHandler: authenticate }, async (req, reply) => {
    const userId = req.user!.userId;
    const { packId } = req.params as { packId: string };
    const { blobId, emoji } = (req.body ?? {}) as { blobId?: string; emoji?: string };

    if (!blobId || !HEX64.test(blobId)) {
      return reply.code(400).send({ error: 'invalid blobId' });
    }

    // Check pack ownership
    const pack = await pool.query(
      'SELECT user_id FROM sticker_packs WHERE pack_id = $1',
      [packId],
    );
    if (pack.rowCount === 0) {
      return reply.code(404).send({ error: 'not found' });
    }
    if (pack.rows[0].user_id !== userId) {
      return reply.code(403).send({ error: 'forbidden' });
    }

    // Check blob existence
    const blob = await pool.query('SELECT blob_id FROM blobs WHERE blob_id = $1', [blobId]);
    if (blob.rowCount === 0) {
      return reply.code(400).send({ error: 'unknown blob' });
    }

    // Position = next sequential number
    const posRes = await pool.query(
      'SELECT COALESCE(MAX(position), -1) + 1 AS next_pos FROM sticker_items WHERE pack_id = $1',
      [packId],
    );
    const position = posRes.rows[0].next_pos;

    const res = await pool.query(
      'INSERT INTO sticker_items(pack_id, blob_id, position, emoji) VALUES ($1, $2, $3, $4) RETURNING item_id',
      [packId, blobId, position, emoji ?? null],
    );
    return reply.code(201).send({ itemId: res.rows[0].item_id, position });
  });

  // Get pack stickers
  app.get('/sticker-packs/:packId/items', { preHandler: authenticate }, async (req, reply) => {
    const { packId } = req.params as { packId: string };
    const res = await pool.query(
      'SELECT item_id, blob_id, position, emoji FROM sticker_items WHERE pack_id = $1 ORDER BY position',
      [packId],
    );
    const items = res.rows.map((r) => ({
      itemId: r.item_id,
      blobId: r.blob_id,
      position: r.position,
      emoji: r.emoji,
    }));
    return reply.send({ items });
  });

  // Remove a sticker from a pack
  app.delete('/sticker-packs/:packId/items/:itemId', { preHandler: authenticate }, async (req, reply) => {
    const userId = req.user!.userId;
    const { packId, itemId } = req.params as { packId: string; itemId: string };

    const pack = await pool.query(
      'SELECT user_id FROM sticker_packs WHERE pack_id = $1',
      [packId],
    );
    if (pack.rowCount === 0) {
      return reply.code(404).send({ error: 'not found' });
    }
    if (pack.rows[0].user_id !== userId) {
      return reply.code(403).send({ error: 'forbidden' });
    }

    await pool.query(
      'DELETE FROM sticker_items WHERE item_id = $1 AND pack_id = $2',
      [itemId, packId],
    );
    return reply.send({ ok: true });
  });

  // Search packs by title (for the catalog — public packs of all users)
  app.get('/sticker-packs/search', { preHandler: authenticate }, async (req, reply) => {
    const q = (req.query as { q?: string }).q ?? '';
    if (q.trim().length === 0) {
      return reply.send({ packs: [] });
    }
    const res = await pool.query(
      `SELECT sp.pack_id, sp.title, sp.created_at,
              (SELECT COUNT(*)::int FROM sticker_items si WHERE si.pack_id = sp.pack_id) AS item_count,
              (SELECT si2.blob_id FROM sticker_items si2 WHERE si2.pack_id = sp.pack_id ORDER BY si2.position LIMIT 1) AS cover_blob_id,
              a.username AS author
       FROM sticker_packs sp
       JOIN accounts a ON a.user_id = sp.user_id
       WHERE sp.title ILIKE '%' || $1 || '%'
       ORDER BY sp.created_at DESC
       LIMIT 50`,
      [q.trim()],
    );
    const packs = res.rows.map((r) => ({
      packId: r.pack_id,
      title: r.title,
      itemCount: r.item_count,
      coverBlobId: r.cover_blob_id,
      author: r.author,
      createdAt: r.created_at.toISOString(),
    }));
    return reply.send({ packs });
  });
}
