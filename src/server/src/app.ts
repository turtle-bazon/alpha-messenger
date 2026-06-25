import Fastify, { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import { healthRoutes } from './routes/health';
import { authRoutes } from './routes/auth';
import { deviceRoutes } from './routes/devices';
import { meRoutes } from './routes/me';
import { chatRoutes } from './routes/chats';
import { messageRoutes } from './routes/messages';
import { presenceRoutes } from './routes/presence';
import { pushRoutes } from './routes/push';
import { wsRoutes } from './ws';

export function buildApp(): FastifyInstance {
  const app = Fastify({ logger: true });

  // Клиент ходит cross-origin: web из dev-origin :5173, а desktop/android-обёртки
  // — со своих origin (file://, capacitor:// и т.п.). Аутентификация на
  // bearer-токене (не куки), поэтому отражаем любой origin без credentials.
  app.register(cors, { origin: true });

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
      api.register(presenceRoutes);
      api.register(pushRoutes);
    },
    { prefix: '/api' },
  );
  // WebSocket остаётся в корне (/ws) — у прокси для него своё правило (upgrade).
  app.register(wsRoutes);

  return app;
}
