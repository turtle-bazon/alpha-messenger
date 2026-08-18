import { FastifyInstance } from 'fastify';
import { authenticate } from '../auth';
import { config } from '../config';

const TENOR_BASE = 'https://tenor.googleapis.com/v2';

export async function gifRoutes(app: FastifyInstance): Promise<void> {
  app.get('/gifs/search', { preHandler: authenticate }, async (req, reply) => {
    const apiKey = config.tenorApiKey;
    if (!apiKey) {
      return reply.code(503).send({ error: 'GIF search not configured' });
    }

    const { q, limit: lim, pos } = req.query as {
      q?: string;
      limit?: string;
      pos?: string;
    };
    if (!q || q.trim().length === 0) {
      return reply.send({ gifs: [], next: null });
    }

    const limit = Math.min(Number(lim ?? 20), 50);
    const params = new URLSearchParams({
      q: q.trim(),
      key: apiKey,
      client_key: 'alpha-messenger',
      limit: String(limit),
      media_filter: 'tinygif,gif',
    });
    if (pos) params.set('pos', pos);

    try {
      const res = await fetch(`${TENOR_BASE}/search?${params}`);
      if (!res.ok) {
        return reply.code(502).send({ error: 'tenor error' });
      }
      const data = (await res.json()) as {
        results: Array<{
          id: string;
          title: string;
          media_formats: {
            tinygif: { url: string; dims: [number, number]; size: number };
            gif: { url: string; dims: [number, number]; size: number };
          };
        }>;
        next: string;
      };

      const gifs = data.results.map((r) => ({
        id: r.id,
        title: r.title,
        url: r.media_formats.tinygif.url,
        fullUrl: r.media_formats.gif.url,
        width: r.media_formats.tinygif.dims[0],
        height: r.media_formats.tinygif.dims[1],
      }));

      return reply.send({ gifs, next: data.next ?? null });
    } catch {
      return reply.code(502).send({ error: 'tenor fetch failed' });
    }
  });
}
