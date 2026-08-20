import { FastifyInstance } from 'fastify';
import { authenticate } from '../auth';
import { unfurl } from '../unfurl';

export async function unfurlRoutes(app: FastifyInstance): Promise<void> {
  // Link preview (#32). The sender's client sends a URL, the server fetches the
  // page itself (the browser is blocked by CORS) and returns OpenGraph metadata
  // + image bytes. The client embeds the preview into the message as a
  // kind:'link' attachment (E2EE-compatible).
  app.post('/unfurl', { preHandler: authenticate }, async (req, reply) => {
    const body = req.body as { url?: unknown } | undefined;
    const url = body?.url;
    if (typeof url !== 'string' || url.length === 0 || url.length > 2048) {
      return reply.code(400).send({ error: 'url required' });
    }
    try {
      const preview = await unfurl(url);
      return reply.send({ preview }); // preview=null — page has no preview/is unavailable
    } catch {
      // unfurl throws only on non-http/https URLs
      return reply.code(400).send({ error: 'invalid url' });
    }
  });
}
