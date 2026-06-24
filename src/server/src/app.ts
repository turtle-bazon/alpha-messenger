import Fastify, { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import { healthRoutes } from './routes/health';
import { authRoutes } from './routes/auth';
import { deviceRoutes } from './routes/devices';
import { meRoutes } from './routes/me';
import { chatRoutes } from './routes/chats';
import { messageRoutes } from './routes/messages';
import { pushRoutes } from './routes/push';
import { wsRoutes } from './ws';

export function buildApp(): FastifyInstance {
  const app = Fastify({ logger: true });

  // Клиент ходит cross-origin: web из dev-origin :5173, а desktop/android-обёртки
  // — со своих origin (file://, capacitor:// и т.п.). Аутентификация на
  // bearer-токене (не куки), поэтому отражаем любой origin без credentials.
  app.register(cors, { origin: true });

  app.register(healthRoutes);
  app.register(authRoutes);
  app.register(deviceRoutes);
  app.register(meRoutes);
  app.register(chatRoutes);
  app.register(messageRoutes);
  app.register(pushRoutes);
  app.register(wsRoutes);

  return app;
}
