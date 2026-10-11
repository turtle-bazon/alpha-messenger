import { FastifyInstance } from 'fastify';
import { pool } from '../db';
import { authenticate } from '../auth';
import { getVapidKeys, sendTestPush } from '../push';

const PROVIDERS = new Set(['fcm', 'unifiedpush', 'webpush']);

interface TestBody {
  deviceId?: string;
  testId?: string;
  title?: string;
  body?: string;
}

interface SubscribeBody {
  deviceId?: string;
  provider?: string;
  endpoint?: string;
}

export async function pushRoutes(app: FastifyInstance): Promise<void> {
  // Register a device push channel. Idempotent by (device_id, endpoint):
  // resending the same token returns the same subscription.
  app.post(
    '/push/subscriptions',
    { preHandler: authenticate },
    async (req, reply) => {
      const { deviceId, provider, endpoint } = (req.body ??
        {}) as SubscribeBody;
      const userId = req.user!.userId;
      if (!deviceId || !provider || !endpoint) {
        return reply
          .code(400)
          .send({ error: 'missing deviceId/provider/endpoint' });
      }
      if (!PROVIDERS.has(provider)) {
        return reply.code(400).send({ error: 'unknown provider' });
      }
      // Only your own device can be subscribed.
      const dev = await pool.query(
        'SELECT 1 FROM devices WHERE device_id = $1 AND user_id = $2',
        [deviceId, userId],
      );
      if (dev.rowCount === 0) {
        return reply.code(404).send({ error: 'device not found' });
      }
      if (provider === 'webpush' && !isWebPushSubscription(endpoint)) {
        return reply.code(400).send({ error: 'malformed web push subscription' });
      }
      // Clean up old subscriptions of the same provider. FCM / UnifiedPush:
      // across the whole account — after app reinstall device_id and endpoint
      // change, but ntfy on the phone may still listen on old topics. Web push:
      // only this device's — every browser of the account keeps its own, and a
      // browser that recreated its subscription leaves the old one dead. The
      // same browser subscription left on another device record (another
      // account logged in here before) goes too: it would get that account's push.
      if (provider === 'webpush') {
        await pool.query(
          `DELETE FROM push_subscriptions
            WHERE provider = 'webpush'
              AND ((device_id = $1 AND endpoint != $2)
                OR (device_id != $1 AND endpoint = $2))`,
          [deviceId, endpoint],
        );
      } else {
        await pool.query(
          `DELETE FROM push_subscriptions ps
            USING devices d
           WHERE ps.device_id = d.device_id
             AND d.user_id = $1
             AND ps.provider = $2
             AND ps.endpoint != $3`,
          [userId, provider, endpoint],
        );
      }
      const { rows } = await pool.query(
        `INSERT INTO push_subscriptions(device_id, provider, endpoint)
         VALUES ($1, $2, $3)
         ON CONFLICT (device_id, endpoint)
           DO UPDATE SET provider = EXCLUDED.provider
         RETURNING subscription_id`,
        [deviceId, provider, endpoint],
      );
      return reply.code(201).send({ subscriptionId: rows[0].subscription_id });
    },
  );

  // Public VAPID key the browser subscribes with (applicationServerKey).
  // Not secret, but behind auth like the rest: only a logged-in client needs it.
  app.get('/push/vapid-public-key', { preHandler: authenticate }, async () => {
    const { publicKey } = await getVapidKeys();
    return { publicKey };
  });

  // Test notification to one of your own devices (the "check notifications"
  // button). Answers after the push services did, with their status per
  // subscription: 200 means the check ran, success is in the body.
  // Empty results = the device has no push channel at all.
  app.post('/push/test', { preHandler: authenticate }, async (req, reply) => {
    const { deviceId, testId, title, body } = (req.body ?? {}) as TestBody;
    const userId = req.user!.userId;
    if (!deviceId) {
      return reply.code(400).send({ error: 'missing deviceId' });
    }
    const dev = await pool.query(
      'SELECT 1 FROM devices WHERE device_id = $1 AND user_id = $2',
      [deviceId, userId],
    );
    if (dev.rowCount === 0) {
      return reply.code(404).send({ error: 'device not found' });
    }
    const results = await sendTestPush(userId, deviceId, {
      testId: (testId ?? '').slice(0, 64),
      // Texts come from the client (it has the UI language); short fallbacks.
      title: (title || 'Test notification').slice(0, 100),
      body: (body || 'Push notifications on this device work').slice(0, 300),
    });
    return reply.send({ results });
  });

  // Delete a subscription. Only your own (via device ownership by the account).
  app.delete(
    '/push/subscriptions/:subscriptionId',
    { preHandler: authenticate },
    async (req, reply) => {
      const { subscriptionId } = req.params as { subscriptionId: string };
      const userId = req.user!.userId;
      await pool.query(
        `DELETE FROM push_subscriptions ps
           USING devices d
          WHERE ps.subscription_id = $1
            AND ps.device_id = d.device_id
            AND d.user_id = $2`,
        [subscriptionId, userId],
      );
      // Idempotent: no subscription still returns ok.
      return reply.send({ ok: true });
    },
  );
}

// A web push "endpoint" is the browser's whole PushSubscription JSON.
function isWebPushSubscription(raw: string): boolean {
  try {
    const sub = JSON.parse(raw) as {
      endpoint?: unknown;
      keys?: { p256dh?: unknown; auth?: unknown };
    };
    return (
      typeof sub.endpoint === 'string' &&
      /^https:\/\//.test(sub.endpoint) &&
      typeof sub.keys?.p256dh === 'string' &&
      typeof sub.keys?.auth === 'string'
    );
  } catch {
    return false;
  }
}
