import { FastifyInstance } from 'fastify';
import { readFileSync, existsSync, statSync } from 'fs';
import { join, extname } from 'path';

// Маршруты для раздачи файлов веб-клиента.
// Используется Android-приложением для скачивания обновлений (manifest.json + файлы бандла).
// Каталог задаётся через WEB_CLIENT_DIR (по умолчанию: /app/web_client).

const WEB_CLIENT_DIR = process.env.WEB_CLIENT_DIR || '/app/web_client';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
};

function safePath(requested: string): string | null {
  // Запрещаем path traversal
  const normalized = requested.replace(/\\/g, '/').replace(/\/+/g, '/');
  if (normalized.startsWith('..') || normalized.startsWith('/')) return null;
  return normalized;
}

export async function clientRoutes(app: FastifyInstance): Promise<void> {
  // Манифест — список файлов бандла и версия
  app.get('/client/manifest.json', async (req, reply) => {
    const file = join(WEB_CLIENT_DIR, 'manifest.json');
    if (!existsSync(file)) return reply.code(404).send({ error: 'not built' });
    const data = readFileSync(file, 'utf-8');
    return reply
      .header('Content-Type', 'application/json; charset=utf-8')
      .header('Cache-Control', 'no-cache')
      .send(data);
  });

  // Любой файл из бандла клиента
  app.get<{ Params: { '*': string } }>('/client/*', async (req, reply) => {
    const raw = (req.params as { '*': string })['*'];
    const rel = safePath(raw);
    if (!rel) return reply.code(400).send({ error: 'invalid path' });

    const file = join(WEB_CLIENT_DIR, rel);
    if (!existsSync(file) || !statSync(file).isFile()) {
      return reply.code(404).send({ error: 'not found' });
    }

    const ext = extname(file);
    const mime = MIME[ext] || 'application/octet-stream';
    const data = readFileSync(file);

    return reply
      .header('Content-Type', mime)
      .header('Cache-Control', 'public, max-age=31536000, immutable')
      .send(data);
  });
}
