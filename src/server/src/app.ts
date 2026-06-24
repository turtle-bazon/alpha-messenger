import Fastify, { FastifyInstance } from 'fastify';
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
