import { FastifyInstance } from 'fastify';

// version.json отдаёт git hash текущей сборки. Клиент проверяет каждые 5 мин
// и перезагружается при несовпадении (авто-обновление без Ctrl+Shift+R).
// Хеш передаётся при сборке Docker через GIT_HASH build arg.

const GIT_HASH = process.env.GIT_HASH || 'dev';

export async function versionRoutes(app: FastifyInstance): Promise<void> {
  app.get('/version.json', async () => ({
    version: GIT_HASH,
  }));
}
