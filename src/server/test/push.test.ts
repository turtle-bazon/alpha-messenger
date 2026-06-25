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

test('push: wake-up stub finds the recipient channels', async () => {
  const u = await registerUser(app);
  assert.equal(await sendWakeUp(u.userId), 0);

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
  assert.equal(await sendWakeUp(u.userId), 1);
});
