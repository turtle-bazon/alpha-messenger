import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { buildApp } from '../src/app';
import { pool } from '../src/db';
import { runMigrations } from '../src/migrate';

const app = buildApp();

before(async () => {
  await runMigrations();
  await app.ready();
});

after(async () => {
  await app.close();
  await pool.end();
});

async function makeInvite(): Promise<string> {
  const code = randomBytes(12).toString('base64url');
  await pool.query('INSERT INTO invites(code) VALUES ($1)', [code]);
  return code;
}

test('register (invite-only), login, /me, /devices', async () => {
  const username = `u_${randomBytes(6).toString('hex')}`;
  const password = `pw-${randomBytes(4).toString('hex')}`;
  const deviceId = randomUUID();

  // регистрация с плохим инвайтом -> 400
  let res = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { username, password, invite: 'nope', deviceId },
  });
  assert.equal(res.statusCode, 400);

  // регистрация с валидным инвайтом -> 201
  const code = await makeInvite();
  res = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { username, password, invite: code, deviceId },
  });
  assert.equal(res.statusCode, 201);
  const reg = res.json();
  assert.ok(reg.accessToken);
  assert.equal(reg.username, username);

  // инвайт одноразовый -> повторное использование 400
  res = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: {
      username: `${username}x`,
      password,
      invite: code,
      deviceId: randomUUID(),
    },
  });
  assert.equal(res.statusCode, 400);

  // занятый username -> 409
  const code2 = await makeInvite();
  res = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { username, password, invite: code2, deviceId: randomUUID() },
  });
  assert.equal(res.statusCode, 409);

  // логин с неверным паролем -> 401
  res = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { username, password: 'wrong', deviceId },
  });
  assert.equal(res.statusCode, 401);

  // логин корректный -> 200
  res = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { username, password, deviceId },
  });
  assert.equal(res.statusCode, 200);
  const token: string = res.json().accessToken;
  assert.ok(token);

  // /me без токена -> 401
  res = await app.inject({ method: 'GET', url: '/api/me' });
  assert.equal(res.statusCode, 401);

  // /me с токеном -> 200, username и устройство на месте
  res = await app.inject({
    method: 'GET',
    url: '/api/me',
    headers: { authorization: `Bearer ${token}` },
  });
  assert.equal(res.statusCode, 200);
  const me = res.json();
  assert.equal(me.username, username);
  assert.ok(me.devices.some((d: { deviceId: string }) => d.deviceId === deviceId));

  // POST /devices с токеном -> 200
  res = await app.inject({
    method: 'POST',
    url: '/api/devices',
    headers: { authorization: `Bearer ${token}` },
    payload: { deviceId: randomUUID(), devicePublicKey: 'pk' },
  });
  assert.equal(res.statusCode, 200);

  // события device.added и auth.attempt записаны в outbox
  const ev = await pool.query('SELECT type FROM events WHERE user_id = $1', [
    reg.userId,
  ]);
  const types = ev.rows.map((r: { type: string }) => r.type);
  assert.ok(types.includes('device.added'));
  assert.ok(types.includes('auth.attempt'));
});
