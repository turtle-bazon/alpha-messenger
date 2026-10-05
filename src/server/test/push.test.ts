import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../src/app';
import { pool } from '../src/db';
import { runMigrations } from '../src/migrate';
import { sendWakeUp } from '../src/push';
import { auth, registerUser } from './helpers';

const app = buildApp();

before(async () => {
  await runMigrations();
  await app.ready();
});

after(async () => {
  await app.close();
  await pool.end();
});

test('push: subscribe is idempotent by (device, endpoint)', async () => {
  const u = await registerUser(app);
  const endpoint = `https://fcm.example/${u.userId}`;

  const first = await app.inject({
    method: 'POST',
    url: '/api/push/subscriptions',
    headers: auth(u.token),
    payload: { deviceId: u.deviceId, provider: 'fcm', endpoint },
  });
  assert.equal(first.statusCode, 201);
  const subId = first.json().subscriptionId;
  assert.ok(subId);

  // повтор того же токена — та же подписка, не дубликат
  const again = await app.inject({
    method: 'POST',
    url: '/api/push/subscriptions',
    headers: auth(u.token),
    payload: { deviceId: u.deviceId, provider: 'fcm', endpoint },
  });
  assert.equal(again.statusCode, 201);
  assert.equal(again.json().subscriptionId, subId);
});

test('push: rejects unknown provider and foreign device', async () => {
  const u = await registerUser(app);
  const other = await registerUser(app);

  const badProvider = await app.inject({
    method: 'POST',
    url: '/api/push/subscriptions',
    headers: auth(u.token),
    payload: { deviceId: u.deviceId, provider: 'apns', endpoint: 'x' },
  });
  assert.equal(badProvider.statusCode, 400);

  // нельзя подписать чужое устройство
  const foreign = await app.inject({
    method: 'POST',
    url: '/api/push/subscriptions',
    headers: auth(u.token),
    payload: {
      deviceId: other.deviceId,
      provider: 'unifiedpush',
      endpoint: 'y',
    },
  });
  assert.equal(foreign.statusCode, 404);
});

test('push: delete is scoped to owner and idempotent', async () => {
  const u = await registerUser(app);
  const endpoint = `https://up.example/${u.userId}`;
  const sub = await app.inject({
    method: 'POST',
    url: '/api/push/subscriptions',
    headers: auth(u.token),
    payload: { deviceId: u.deviceId, provider: 'unifiedpush', endpoint },
  });
  const subId = sub.json().subscriptionId;

  const del = await app.inject({
    method: 'DELETE',
    url: `/api/push/subscriptions/${subId}`,
    headers: auth(u.token),
  });
  assert.equal(del.statusCode, 200);
  assert.deepEqual(del.json(), { ok: true });

  // повторное удаление — всё равно ok
  const delAgain = await app.inject({
    method: 'DELETE',
    url: `/api/push/subscriptions/${subId}`,
    headers: auth(u.token),
  });
  assert.equal(delAgain.statusCode, 200);
});

// Подменяем транспорт UnifiedPush локальным HTTP-сервером: sendWakeUp делает
// реальный fetch на endpoint, поэтому без «живого» ntfy (и без FCM-кредов)
// проверить доставку и чистку подписок невозможно.
interface FakeNtfy {
  url: string;
  received: () => number;
  setStatus: (code: 200 | 404 | 500) => void;
  close: () => Promise<void>;
}

async function startFakeNtfy(): Promise<FakeNtfy> {
  const state = { received: 0, status: 200 as 200 | 404 | 500 };
  const { createServer } = await import('node:http');
  const server = createServer((_req, res) => {
    state.received += 1;
    res.writeHead(state.status);
    res.end(state.status === 200 ? 'ok' : 'err');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as { port: number };
  return {
    url: `http://127.0.0.1:${port}/up`,
    received: () => state.received,
    setStatus: (code) => {
      state.status = code;
    },
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

test('push: wake-up reaches the UnifiedPush endpoint', async () => {
  const n = await startFakeNtfy();
  try {
    const u = await registerUser(app);
    assert.equal(await sendWakeUp(u.userId), 0); // no channels yet

    const sub = await app.inject({
      method: 'POST',
      url: '/api/push/subscriptions',
      headers: auth(u.token),
      payload: {
        deviceId: u.deviceId,
        provider: 'unifiedpush',
        endpoint: n.url,
      },
    });
    assert.equal(sub.statusCode, 201);

    assert.equal(await sendWakeUp(u.userId), 1);
    assert.equal(n.received(), 1);

    // Subscription stays while the provider accepts it.
    const rows = await pool.query(
      'SELECT count(*)::int AS c FROM push_subscriptions WHERE device_id = $1',
      [u.deviceId],
    );
    assert.equal(rows.rows[0].c, 1);
  } finally {
    await n.close();
  }
});

test('push: subscription is dropped only when the provider rejects the token', async () => {
  const n = await startFakeNtfy();
  try {
    // 500 — transient server-side failure: subscription must survive.
    n.setStatus(500);
    const u = await registerUser(app);
    await app.inject({
      method: 'POST',
      url: '/api/push/subscriptions',
      headers: auth(u.token),
      payload: { deviceId: u.deviceId, provider: 'unifiedpush', endpoint: n.url },
    });
    assert.equal(await sendWakeUp(u.userId), 0);
    let rows = await pool.query(
      'SELECT count(*)::int AS c FROM push_subscriptions WHERE device_id = $1',
      [u.deviceId],
    );
    assert.equal(rows.rows[0].c, 1, 'transient failure must not remove the subscription');

    // 404 — the topic/token is gone: now it is cleaned up.
    n.setStatus(404);
    assert.equal(await sendWakeUp(u.userId), 0);
    rows = await pool.query(
      'SELECT count(*)::int AS c FROM push_subscriptions WHERE device_id = $1',
      [u.deviceId],
    );
    assert.equal(rows.rows[0].c, 0, 'invalid token must be removed');
  } finally {
    await n.close();
  }
});

test('push: unconfigured FCM keeps the subscription', async () => {
  // FCM_* are not set in tests — a token registered for FCM must not be wiped
  // by the "provider not configured" path.
  const u = await registerUser(app);
  await app.inject({
    method: 'POST',
    url: '/api/push/subscriptions',
    headers: auth(u.token),
    payload: {
      deviceId: u.deviceId,
      provider: 'fcm',
      endpoint: `https://fcm.example/wake/${u.userId}`,
    },
  });
  assert.equal(await sendWakeUp(u.userId), 0);
  const rows = await pool.query(
    'SELECT count(*)::int AS c FROM push_subscriptions WHERE device_id = $1',
    [u.deviceId],
  );
  assert.equal(rows.rows[0].c, 1, 'FCM token must survive when FCM is not configured');
});
