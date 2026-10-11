import webpush from 'web-push';
import { pool } from './db';

// Push is a transport-independent "wake up the client" channel (see
// doc/architecture.md). FCM / UnifiedPush carry no message content: on wake-up
// the native client reopens the WS and re-syncs via hello/lastSeq.
//
// Web Push (browsers, the iOS home screen app) is different: a service worker
// can't hold a WS, and Safari revokes the subscription of a page that receives
// a push without showing a notification. So a web push is sent only for what
// must be shown (a new message from someone else, a test) and carries what the
// worker needs to draw it — the same opaque ciphertext the WS would deliver,
// encrypted end-to-end for the browser (RFC 8291), plus chat/sender names.

// --- Configuration ---

const FCM_PROJECT_ID = process.env.FCM_PROJECT_ID ?? '';
const FCM_SERVICE_ACCOUNT_KEY = process.env.FCM_SERVICE_ACCOUNT_KEY ?? ''; // JSON key

// --- FCM HTTP v1 API ---

interface FCMMessage {
  message: {
    token: string;
    data?: Record<string, string>;
    android?: {
      priority: 'high';
    };
  };
}

async function sendFCM(token: string, chatId?: string): Promise<PushOutcome> {
  if (!FCM_PROJECT_ID || !FCM_SERVICE_ACCOUNT_KEY) {
    // Not configured — this deployment just doesn't use FCM. Deliver nothing,
    // but keep the subscription: deleting it here used to wipe every device
    // token on an FCM-less instance.
    console.log('FCM not configured, skipping');
    return 'retry';
  }

  try {
    const accessToken = await getFCMAccessToken();
    if (!accessToken) return 'retry';

    const url = `https://fcm.googleapis.com/v1/projects/${FCM_PROJECT_ID}/messages:send`;
    const body: FCMMessage = {
      message: {
        token,
        data: { type: 'wake-up', ...(chatId ? { chatId } : {}) },
        android: { priority: 'high' },
      },
    };

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (res.status === 404 || res.status === 410) {
      // Provider rejected the token — the only case that justifies removal.
      return 'invalid';
    }

    if (!res.ok) {
      console.error(`FCM error: ${res.status} ${await res.text()}`);
      return 'retry';
    }

    return 'sent';
  } catch (err) {
    console.error('FCM send failed:', err);
    return 'retry';
  }
}

// Get FCM access token via service account
async function getFCMAccessToken(): Promise<string | null> {
  try {
    if (!FCM_SERVICE_ACCOUNT_KEY) return null;
    const key = JSON.parse(FCM_SERVICE_ACCOUNT_KEY);

    // JWT for Google OAuth2
    const now = Math.floor(Date.now() / 1000);
    const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(JSON.stringify({
      iss: key.client_email,
      scope: 'https://www.googleapis.com/auth/firebase.messaging',
      aud: 'https://oauth2.googleapis.com/token',
      exp: now + 3600,
      iat: now,
    })).toString('base64url');

    const unsignedJwt = `${header}.${payload}`;

    // RSA-SHA256 signature
    const crypto = await import('node:crypto');
    const sign = crypto.createSign('RSA-SHA256');
    sign.update(unsignedJwt);
    const signature = sign.sign(key.private_key, 'base64url');
    const jwt = `${unsignedJwt}.${signature}`;

    // Exchange JWT for access token
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`,
    });

    if (!res.ok) return null;
    const data = await res.json() as { access_token?: string };
    return data.access_token ?? null;
  } catch {
    return null;
  }
}

// --- UnifiedPush (ntfy) ---

async function sendUnifiedPush(endpoint: string, chatId?: string): Promise<PushOutcome> {
  try {
    console.log(`UP: sending to ${endpoint}`);

    // Message format for ntfy: JSON or plain text
    // Use JSON to carry chatId
    const message = chatId
      ? JSON.stringify({ type: 'wake-up', chatId })
      : 'wake-up';

    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-UnifiedPush': '1',  // Disable Firebase for UnifiedPush
      },
      body: message,
    });

    console.log(`UP: response ${res.status} ${res.statusText}`);
    if (res.status === 404 || res.status === 410) {
      // ntfy says the topic is gone — the token is dead, drop the subscription.
      return 'invalid';
    }

    if (!res.ok) {
      console.error(`UP error: ${res.status} ${await res.text()}`);
      return 'retry';
    }

    return 'sent';
  } catch (err) {
    console.error('UP send failed:', err);
    return 'retry';
  }
}

// --- Web Push (VAPID) ---

// Contact of the sender, required in the VAPID JWT. Apple rejects the token
// (403 BadJwtToken) when it points to localhost, so the default is a real URL.
const VAPID_SUBJECT =
  process.env.VAPID_SUBJECT || 'https://github.com/turtle-bazon/alpha-messenger';
// Apple, FCM and Mozilla all accept up to 4096 bytes of encrypted record; keep
// the plaintext well below (encryption adds ~100 bytes, JSON wraps the rest).
const WEBPUSH_MAX_CIPHERTEXT = 2800;
const WEBPUSH_TTL_SECONDS = 24 * 3600;

interface VapidKeys {
  publicKey: string;
  privateKey: string;
}

let vapidKeys: Promise<VapidKeys> | null = null;

// VAPID key pair: from VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY if given, otherwise
// generated once and stored in server_secrets — so a fresh deployment works
// without configuration and keeps its key (and thus every browser subscription)
// across restarts. Rotating the key invalidates all web subscriptions; clients
// notice the new key and resubscribe.
export function getVapidKeys(): Promise<VapidKeys> {
  if (!vapidKeys) {
    vapidKeys = loadVapidKeys().catch((err) => {
      vapidKeys = null;
      throw err;
    });
  }
  return vapidKeys;
}

async function loadVapidKeys(): Promise<VapidKeys> {
  const envPublic = process.env.VAPID_PUBLIC_KEY;
  const envPrivate = process.env.VAPID_PRIVATE_KEY;
  if (envPublic && envPrivate) return { publicKey: envPublic, privateKey: envPrivate };
  const generated = webpush.generateVAPIDKeys();
  // ON CONFLICT DO NOTHING + re-read: replicas starting at once agree on one pair.
  await pool.query(
    `INSERT INTO server_secrets(name, value) VALUES ('vapid', $1)
     ON CONFLICT (name) DO NOTHING`,
    [JSON.stringify(generated)],
  );
  const { rows } = await pool.query(
    "SELECT value FROM server_secrets WHERE name = 'vapid'",
  );
  return JSON.parse(rows[0].value) as VapidKeys;
}

// What the service worker gets (see web_client/public/sw.js).
export type WebPushPayload =
  | {
      type: 'message';
      chatId: string;
      messageId: string;
      title: string; // chat title for groups/channels, sender name for direct chats
      sender: string | null; // prefix for group messages ("sender: text"), null otherwise
      ciphertext: string | null; // null when too large for a push record
      isReply: boolean;
    }
  | { type: 'test'; testId: string; title: string; body: string };

interface DeliveryResult {
  outcome: PushOutcome;
  statusCode?: number;
  message?: string;
}

async function sendWebPush(subscriptionJson: string, payload: WebPushPayload): Promise<DeliveryResult> {
  let subscription: webpush.PushSubscription;
  try {
    subscription = JSON.parse(subscriptionJson);
  } catch {
    return { outcome: 'invalid', message: 'malformed subscription' };
  }
  try {
    const keys = await getVapidKeys();
    const res = await webpush.sendNotification(subscription, JSON.stringify(payload), {
      vapidDetails: { subject: VAPID_SUBJECT, ...keys },
      TTL: WEBPUSH_TTL_SECONDS,
      // Without high urgency Android holds the push until it leaves Doze.
      urgency: 'high',
      // No Topic header on purpose: Apple base64-decodes it and rejects
      // anything that isn't valid base64url of the right length.
    });
    return { outcome: 'sent', statusCode: res.statusCode, message: res.body || undefined };
  } catch (err) {
    const e = err as { statusCode?: number; body?: string; message?: string };
    const statusCode = e.statusCode;
    // The body matters: Apple names the rejected header in it (e.g. BadJwtToken).
    const message = (e.body || e.message || String(err)).slice(0, 500);
    console.error(`WebPush error: ${statusCode ?? '-'} ${message}`);
    // 404/410 — the subscription is gone; 403 — signed with a key the
    // subscription wasn't made for (VAPID rotated): resubscribing is the only fix.
    if (statusCode === 404 || statusCode === 410 || statusCode === 403) {
      return { outcome: 'invalid', statusCode, message };
    }
    return { outcome: 'retry', statusCode, message };
  }
}

// Builds the notification for a new message. Returns null when there is
// nothing to show (message gone, own message).
async function buildMessagePayload(
  userId: string,
  messageId: string,
): Promise<WebPushPayload | null> {
  const { rows } = await pool.query(
    `SELECT m.chat_id, m.sender_id, m.ciphertext, m.deleted, m.reply_to_message_id,
            c.type, c.title, c.username AS channel_username, a.username AS sender_name
       FROM messages m
       JOIN chats c ON c.chat_id = m.chat_id
       JOIN accounts a ON a.user_id = m.sender_id
      WHERE m.message_id = $1`,
    [messageId],
  );
  const r = rows[0];
  if (!r || r.sender_id === userId || r.deleted) return null;
  const isGroup = r.type === 'group';
  const isChannel = isGroup && !!r.channel_username;
  const ciphertext = (r.ciphertext as Buffer).toString('base64');
  return {
    type: 'message',
    chatId: r.chat_id,
    messageId: String(messageId),
    title: isGroup ? (r.title ?? '') : r.sender_name,
    sender: isGroup && !isChannel ? r.sender_name : null,
    ciphertext: ciphertext.length <= WEBPUSH_MAX_CIPHERTEXT ? ciphertext : null,
    isReply: !!r.reply_to_message_id,
  };
}

async function recordStatus(subscriptionId: string, statusCode?: number): Promise<void> {
  if (statusCode === undefined) return;
  await pool.query(
    `UPDATE push_subscriptions SET last_status_code = $2, last_status_at = now()
      WHERE subscription_id = $1`,
    [subscriptionId, statusCode],
  );
}

// --- Main function ---

// Delivery outcome of a single push attempt. Only 'invalid' (the provider
// explicitly rejected the token) justifies deleting the subscription:
// a transient network error or an unconfigured provider must keep it, or the
// device would silently lose push until it re-registers.
type PushOutcome = 'sent' | 'invalid' | 'retry';

// The outbox event that triggered the wake-up (see events.ts).
export interface WakeUpEvent {
  type?: string;
  messageId?: string;
  senderId?: string;
}

export async function sendWakeUp(
  userId: string,
  onlineDeviceIds?: Set<string>,
  chatId?: string,
  event?: WakeUpEvent,
): Promise<number> {
  // FCM / UnifiedPush: one (the newest) subscription per provider — a wake-up
  // per provider is enough. Web push: every browser has its own subscription.
  const { rows } = await pool.query(
    `SELECT DISTINCT ON (CASE WHEN ps.provider = 'webpush'
                              THEN ps.subscription_id::text ELSE ps.provider END)
            ps.subscription_id, ps.provider, ps.endpoint, ps.device_id
       FROM push_subscriptions ps
       JOIN devices d ON d.device_id = ps.device_id
      WHERE d.user_id = $1
      ORDER BY CASE WHEN ps.provider = 'webpush'
                    THEN ps.subscription_id::text ELSE ps.provider END,
               ps.subscription_id DESC`,
    [userId],
  );

  // Filter: push only to devices not among the online ones.
  const toNotify = onlineDeviceIds
    ? rows.filter((r) => !onlineDeviceIds.has(r.device_id))
    : rows;
  if (toNotify.length === 0) return 0;

  // A web push must always end in a visible notification, so it goes only for
  // a new message from someone else; every other event is a silent no-op there.
  let webPayload: WebPushPayload | null | undefined;
  const webPayloadFor = async (): Promise<WebPushPayload | null> => {
    if (webPayload === undefined) {
      webPayload =
        event?.type === 'message.new' && event.messageId && event.senderId !== userId
          ? await buildMessagePayload(userId, event.messageId)
          : null;
    }
    return webPayload;
  };

  let sent = 0;
  const invalidSubscriptions: string[] = [];

  for (const r of toNotify) {
    let result: DeliveryResult = { outcome: 'retry' };

    if (r.provider === 'fcm') {
      console.log(`Push: fcm device=${r.device_id}`);
      result = { outcome: await sendFCM(r.endpoint, chatId) };
    } else if (r.provider === 'unifiedpush') {
      console.log(`Push: unifiedpush endpoint=${r.endpoint} device=${r.device_id}`);
      result = { outcome: await sendUnifiedPush(r.endpoint, chatId) };
    } else if (r.provider === 'webpush') {
      const payload = await webPayloadFor();
      if (!payload) continue;
      result = await sendWebPush(r.endpoint, payload);
      await recordStatus(r.subscription_id, result.statusCode);
      console.log(`Push: webpush device=${r.device_id} -> ${result.statusCode ?? result.outcome}`);
    }

    if (result.outcome === 'sent') {
      sent++;
    } else if (result.outcome === 'invalid') {
      invalidSubscriptions.push(r.subscription_id);
    }
  }

  await removeSubscriptions(invalidSubscriptions);
  return sent;
}

async function removeSubscriptions(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await pool.query(
    `DELETE FROM push_subscriptions WHERE subscription_id = ANY($1)`,
    [ids],
  );
  console.log(`Cleaned up ${ids.length} invalid push subscriptions`);
}

// --- Test notification ---

export interface TestPushResult {
  subscriptionId: string;
  provider: string;
  success: boolean; // the push service accepted it (2xx)
  statusCode?: number; // HTTP status of the push service's answer
  message?: string; // push service answer / error, for logs and tooltips
  removed: boolean; // the push service declared the subscription dead
}

// Sends a test notification to every push subscription of one device of the
// user, regardless of whether the device is online, and answers with what
// each push service said. Whether it actually reached the device is reported
// by the client itself (the service worker echoes testId back to the page).
export async function sendTestPush(
  userId: string,
  deviceId: string,
  opts: { testId: string; title: string; body: string },
): Promise<TestPushResult[]> {
  const { rows } = await pool.query(
    `SELECT ps.subscription_id, ps.provider, ps.endpoint
       FROM push_subscriptions ps
       JOIN devices d ON d.device_id = ps.device_id
      WHERE d.user_id = $1 AND d.device_id = $2
      ORDER BY ps.subscription_id`,
    [userId, deviceId],
  );
  const results: TestPushResult[] = [];
  const invalid: string[] = [];
  for (const r of rows) {
    let result: DeliveryResult;
    if (r.provider === 'webpush') {
      result = await sendWebPush(r.endpoint, { type: 'test', ...opts });
      await recordStatus(r.subscription_id, result.statusCode);
    } else if (r.provider === 'fcm') {
      result = { outcome: await sendFCM(r.endpoint) };
    } else {
      result = { outcome: await sendUnifiedPush(r.endpoint) };
    }
    if (result.outcome === 'invalid') invalid.push(r.subscription_id);
    results.push({
      subscriptionId: r.subscription_id,
      provider: r.provider,
      success: result.outcome === 'sent',
      statusCode: result.statusCode,
      message: result.message,
      removed: result.outcome === 'invalid',
    });
  }
  await removeSubscriptions(invalid);
  return results;
}
