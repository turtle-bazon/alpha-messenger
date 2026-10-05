import { pool } from './db';

// Push is a transport-independent "wake up the client" channel, without message
// content (see doc/architecture.md). On wake-up the client reopens the WS and
// re-syncs via hello/lastSeq — the push itself carries nothing from the outbox.

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

// --- Main function ---

// Delivery outcome of a single push attempt. Only 'invalid' (the provider
// explicitly rejected the token) justifies deleting the subscription:
// a transient network error or an unconfigured provider must keep it, or the
// device would silently lose push until it re-registers.
type PushOutcome = 'sent' | 'invalid' | 'retry';

export async function sendWakeUp(userId: string, onlineDeviceIds?: Set<string>, chatId?: string): Promise<number> {
  const { rows } = await pool.query(
    `SELECT DISTINCT ON (ps.provider) ps.subscription_id, ps.provider, ps.endpoint, ps.device_id
       FROM push_subscriptions ps
       JOIN devices d ON d.device_id = ps.device_id
      WHERE d.user_id = $1
      ORDER BY ps.provider, ps.subscription_id DESC`,
    [userId],
  );

  // Filter: push only to devices not among the online ones.
  const toNotify = onlineDeviceIds
    ? rows.filter((r) => !onlineDeviceIds.has(r.device_id))
    : rows;

  console.log(`Push: sendWakeUp for ${userId}, ${toNotify.length}/${rows.length} offline subscriptions`);

  let sent = 0;
  const invalidSubscriptions: string[] = [];

  for (const r of toNotify) {
    console.log(`Push: ${r.provider} endpoint=${r.endpoint} device=${r.device_id}`);
    let outcome: PushOutcome = 'retry';

    if (r.provider === 'fcm') {
      outcome = await sendFCM(r.endpoint, chatId);
    } else if (r.provider === 'unifiedpush') {
      outcome = await sendUnifiedPush(r.endpoint, chatId);
    }

    if (outcome === 'sent') {
      sent++;
    } else if (outcome === 'invalid') {
      invalidSubscriptions.push(r.subscription_id);
    }
  }

  if (invalidSubscriptions.length > 0) {
    await pool.query(
      `DELETE FROM push_subscriptions WHERE subscription_id = ANY($1)`,
      [invalidSubscriptions],
    );
    console.log(`Cleaned up ${invalidSubscriptions.length} invalid push subscriptions`);
  }

  return sent;
}
