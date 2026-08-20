import { FastifyInstance } from 'fastify';
import { createWriteStream } from 'node:fs';
import { mkdir, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { pool } from '../db';
import { config } from '../config';
import { authenticate } from '../auth';
import { getBlobStore } from '../blobstore';

export const HEX64 = /^[0-9a-f]{64}$/;

export async function blobRoutes(app: FastifyInstance): Promise<void> {
  // Raw body: the blob streams through and is not buffered by the JSON parser. The
  // parser exposes the raw stream as req.body. Scope is this plugin only (/api/blobs).
  app.addContentTypeParser(
    'application/octet-stream',
    (_req, payload, done) => done(null, payload),
  );

  // Blob upload. Body is raw bytes (application/octet-stream). The server
  // computes sha256 on the fly (= blob_id), cuts off over-limit data, stores by
  // hash (dedup: existing blobs are not overwritten) and writes metadata.
  app.post('/blobs', { preHandler: authenticate }, async (req, reply) => {
    const userId = req.user!.userId;
    const store = getBlobStore();

    await mkdir(config.blobTmpDir, { recursive: true });
    const tmpPath = join(config.blobTmpDir, randomUUID());
    const hash = createHash('sha256');
    let size = 0;
    let tooLarge = false;
    // On over-limit we don't break the stream with an error (that hangs the request);
    // instead we drain it to the end, stop writing/hashing, then respond 413.
    const meter = new Transform({
      transform(chunk: Buffer, _enc, cb) {
        if (tooLarge) {
          cb();
          return;
        }
        size += chunk.length;
        if (size > config.maxBlobSize) {
          tooLarge = true;
          cb();
          return;
        }
        hash.update(chunk);
        cb(null, chunk);
      },
    });

    try {
      await pipeline(
        req.body as NodeJS.ReadableStream,
        meter,
        createWriteStream(tmpPath),
      );
    } catch (err) {
      await unlink(tmpPath).catch(() => undefined);
      throw err;
    }

    if (tooLarge) {
      await unlink(tmpPath).catch(() => undefined);
      return reply.code(413).send({ error: 'blob too large' });
    }
    if (size === 0) {
      await unlink(tmpPath).catch(() => undefined);
      return reply.code(400).send({ error: 'empty blob' });
    }

    const blobId = hash.digest('hex');
    try {
      if (!(await store.has(blobId))) {
        await store.putFile(blobId, tmpPath, size);
      }
      await pool.query(
        `INSERT INTO blobs(blob_id, size) VALUES ($1, $2)
         ON CONFLICT (blob_id) DO NOTHING`,
        [blobId, size],
      );
      // different users may have uploaded the same content (dedup) — record each
      // uploader so they can download their blob before it's attached to a message
      await pool.query(
        `INSERT INTO blob_owners(blob_id, user_id) VALUES ($1, $2)
         ON CONFLICT DO NOTHING`,
        [blobId, userId],
      );
    } finally {
      await unlink(tmpPath).catch(() => undefined);
    }

    return reply.code(201).send({ blobId, size });
  });

  // Blob download. Access: the uploader, or a member of a chat containing a
  // non-deleted message referencing this blob.
  app.get('/blobs/:id', { preHandler: authenticate }, async (req, reply) => {
    const userId = req.user!.userId;
    const { id } = req.params as { id: string };
    if (!HEX64.test(id)) return reply.code(404).send({ error: 'not found' });

    const acc = await pool.query(
      `SELECT (
         EXISTS (
           SELECT 1 FROM blob_owners o
           WHERE o.blob_id = $1 AND o.user_id = $2
         )
         OR EXISTS (
           SELECT 1 FROM message_blobs mb
           JOIN messages m ON m.message_id = mb.message_id
           JOIN chat_members cm ON cm.chat_id = m.chat_id
           WHERE mb.blob_id = $1 AND cm.user_id = $2 AND m.deleted = false
         )
       ) AS allowed
       FROM blobs b WHERE b.blob_id = $1`,
      [id, userId],
    );
    if (acc.rowCount === 0) return reply.code(404).send({ error: 'not found' });
    if (!acc.rows[0].allowed) return reply.code(403).send({ error: 'forbidden' });

    const stream = await getBlobStore().get(id);
    if (!stream) return reply.code(404).send({ error: 'not found' });
    reply.header('content-type', 'application/octet-stream');
    return reply.send(stream);
  });
}
