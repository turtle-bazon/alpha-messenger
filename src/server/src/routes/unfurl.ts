import { FastifyInstance } from 'fastify';
import { authenticate } from '../auth';
import { unfurl } from '../unfurl';

export async function unfurlRoutes(app: FastifyInstance): Promise<void> {
  // Превью ссылки (#32). Клиент отправителя шлёт URL, сервер сам тянет страницу
  // (браузеру мешает CORS) и возвращает метаданные OpenGraph + байты картинки.
  // Клиент вшивает превью в сообщение вложением kind:'link' (E2EE-совместимо).
  app.post('/unfurl', { preHandler: authenticate }, async (req, reply) => {
    const body = req.body as { url?: unknown } | undefined;
    const url = body?.url;
    if (typeof url !== 'string' || url.length === 0 || url.length > 2048) {
      return reply.code(400).send({ error: 'url required' });
    }
    try {
      const preview = await unfurl(url);
      return reply.send({ preview }); // preview=null — страница без превью/недоступна
    } catch {
      // unfurl бросает только на не-http/https URL
      return reply.code(400).send({ error: 'invalid url' });
    }
  });
}
