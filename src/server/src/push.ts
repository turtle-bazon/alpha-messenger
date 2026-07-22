import { pool } from './db';

// Пуш — ортогональный транспорту канал «разбудить клиента», без содержимого
// сообщения (см. doc/architecture.md). Получив wake-up, клиент переоткрывает WS
// и досинхронизируется через hello/lastSeq — сам пуш ничего из outbox не несёт.

// --- Конфигурация ---

const FCM_PROJECT_ID = process.env.FCM_PROJECT_ID ?? '';
const FCM_SERVICE_ACCOUNT_KEY = process.env.FCM_SERVICE_ACCOUNT_KEY ?? ''; // JSON ключ

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

async function sendFCM(token: string): Promise<boolean> {
  if (!FCM_PROJECT_ID || !FCM_SERVICE_ACCOUNT_KEY) {
    console.log('FCM not configured, skipping');
    return false;
  }

  try {
    const accessToken = await getFCMAccessToken();
    if (!accessToken) return false;

    const url = `https://fcm.googleapis.com/v1/projects/${FCM_PROJECT_ID}/messages:send`;
    const body: FCMMessage = {
      message: {
        token,
        data: { type: 'wake-up' },
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
      // Токен недействителен — подписка будет удалена вызывающей стороной
      return false;
    }

    if (!res.ok) {
      console.error(`FCM error: ${res.status} ${await res.text()}`);
      return false;
    }

    return true;
  } catch (err) {
    console.error('FCM send failed:', err);
    return false;
  }
}

// Получение access token для FCM через сервисный аккаунт
async function getFCMAccessToken(): Promise<string | null> {
  try {
    if (!FCM_SERVICE_ACCOUNT_KEY) return null;
    const key = JSON.parse(FCM_SERVICE_ACCOUNT_KEY);

    // JWT для Google OAuth2
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

    // Подпись RSA-SHA256
    const crypto = await import('node:crypto');
    const sign = crypto.createSign('RSA-SHA256');
    sign.update(unsignedJwt);
    const signature = sign.sign(key.private_key, 'base64url');
    const jwt = `${unsignedJwt}.${signature}`;

    // Обмен JWT на access token
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

async function sendUnifiedPush(endpoint: string): Promise<boolean> {
  try {
    console.log(`UP: sending to ${endpoint}`);
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        topic: 'wake-up',
        message: 'wake-up',
        priority: 'high',
      }),
    });

    console.log(`UP: response ${res.status} ${res.statusText}`);
    if (!res.ok) {
      const body = await res.text();
      console.error(`UP error: ${res.status} ${body}`);
    }

    if (res.status === 404 || res.status === 410) {
      return false;
    }

    return res.ok;
  } catch (err) {
    console.error('UP send failed:', err);
    return false;
  }
}

// --- Основная функция ---

export async function sendWakeUp(userId: string, onlineDeviceIds?: Set<string>): Promise<number> {
  const { rows } = await pool.query(
    `SELECT ps.subscription_id, ps.provider, ps.endpoint, ps.device_id
       FROM push_subscriptions ps
       JOIN devices d ON d.device_id = ps.device_id
      WHERE d.user_id = $1`,
    [userId],
  );

  // Фильтруем: пушим только тем устройствам, которых нет среди онлайн.
  const toNotify = onlineDeviceIds
    ? rows.filter((r) => !onlineDeviceIds.has(r.device_id))
    : rows;

  console.log(`Push: sendWakeUp for ${userId}, ${toNotify.length}/${rows.length} offline subscriptions`);

  let sent = 0;
  const failedSubscriptions: string[] = [];

  for (const r of toNotify) {
    console.log(`Push: ${r.provider} endpoint=${r.endpoint} device=${r.device_id}`);
    let ok = false;

    if (r.provider === 'fcm') {
      ok = await sendFCM(r.endpoint);
    } else if (r.provider === 'unifiedpush') {
      ok = await sendUnifiedPush(r.endpoint);
    }

    if (ok) {
      sent++;
    } else {
      failedSubscriptions.push(r.subscription_id);
    }
  }

  if (failedSubscriptions.length > 0) {
    await pool.query(
      `DELETE FROM push_subscriptions WHERE subscription_id = ANY($1)`,
      [failedSubscriptions],
    );
    console.log(`Cleaned up ${failedSubscriptions.length} invalid push subscriptions`);
  }

  return sent;
}
