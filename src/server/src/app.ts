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
import { userRoutes } from './routes/users';
import { versionRoutes } from './routes/version';
import { clientRoutes } from './routes/client';
import { stickerRoutes } from './routes/stickers';
import { gifRoutes } from './routes/gifs';
import { channelWebRoutes } from './routes/channel-web';
import { wsRoutes } from './ws';

export function buildApp(): FastifyInstance {
  const app = Fastify({ logger: true });

  // Clients are cross-origin: web from dev origin :5173, desktop/android wrappers
  // from their own origins (file://, capacitor:// etc.). Auth uses a bearer token
  // (not cookies), so any origin is allowed without credentials.
  // Explicitly allow null origin — it comes from the file:// protocol (Android WebView).
  app.register(cors, {
    origin: (_origin, cb) => cb(null, true),
  });

  // All REST endpoints share the /api/ prefix (simplifies the reverse proxy:
  // a single ProxyPass /api/ rule instead of one per group).
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
      api.register(userRoutes);
      api.register(stickerRoutes);
      api.register(gifRoutes);
    },
    { prefix: '/api' },
  );
  // WebSocket stays at the root (/ws) — the proxy has its own rule for it (upgrade).
  app.register(wsRoutes);
  // version.json at the root — the client checks for auto-update.
  app.register(versionRoutes);
  // Web client files for Android updates (/mobile-client/manifest.json, /mobile-client/assets/...).
  app.register(clientRoutes);
  // Public channel pages: /channel/:username/
  app.register(channelWebRoutes);

  return app;
}
