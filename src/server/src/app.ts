import Fastify, { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import { healthRoutes } from './routes/health';
import { authRoutes } from './routes/auth';
import { deviceRoutes } from './routes/devices';
import { meRoutes } from './routes/me';
import { chatRoutes } from './routes/chats';
import { messageRoutes } from './routes/messages';
import { blobRoutes } from './routes/blobs';
import { unfurlRoutes } from './routes/unfurl';
import { presenceRoutes } from './routes/presence';
import { pushRoutes } from './routes/push';
import { reactionRoutes } from './routes/reactions';
import { draftRoutes } from './routes/drafts';
import { versionRoutes } from './routes/version';
import { clientRoutes } from './routes/client';
import { wsRoutes } from './ws';

export function buildApp(): FastifyInstance {
  const app = Fastify({ logger: true });

  // Клиент ходит cross-origin: web из dev-origin :5173, а desktop/android-обёртки
  // — со своих origin (file://, capacitor:// и т.п.). Аутентификация на
  // bearer-токене (не куки), поэтому разрешаем любой origin без credentials.
  // Явно разрешаем null origin — он приходит с file:// протокола (Android WebView).
  app.register(cors, {
    origin: (_origin, cb) => cb(null, true),
  });

  // Все REST-эндпоинты — под общим префиксом /api/ (упрощает обратный прокси:
  // одно правило ProxyPass /api/ вместо правила на каждую группу).
  app.register(
    async (api) => {
      api.register(healthRoutes);
      api.register(authRoutes);
      api.register(deviceRoutes);
      api.register(meRoutes);
      api.register(chatRoutes);
      api.register(messageRoutes);
      api.register(blobRoutes);
      api.register(unfurlRoutes);
      api.register(presenceRoutes);
      api.register(pushRoutes);
      api.register(reactionRoutes);
      api.register(draftRoutes);
    },
    { prefix: '/api' },
  );
  // WebSocket остаётся в корне (/ws) — у прокси для него своё правило (upgrade).
  app.register(wsRoutes);
  // version.json в корне — клиент проверяет авто-обновление.
  app.register(versionRoutes);
  // Файлы веб-клиента для Android-обновлений (/mobile-client/manifest.json, /mobile-client/assets/...).
  app.register(clientRoutes);

  return app;
}
