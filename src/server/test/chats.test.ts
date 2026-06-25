import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { buildApp } from '../src/app';
import { pool } from '../src/db';
import { runMigrations } from '../src/migrate';
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

test('direct create + dedup, group, access control', async () => {
  const a = await registerUser(app);
  const b = await registerUser(app);
  const c = await registerUser(app);

  // A создаёт direct с B -> 201
  let res = await app.inject({
    method: 'POST',
    url: '/api/chats',
    headers: auth(a.token),
    payload: { type: 'direct', username: b.username },
  });
  assert.equal(res.statusCode, 201);
  const chat = res.json();
  assert.equal(chat.type, 'direct');
  assert.equal(chat.unreadCount, 0);
  assert.equal(chat.lastMessage, null);
  assert.deepEqual(
    chat.participants.map((p: { userId: string }) => p.userId).sort(),
    [a.userId, b.userId].sort(),
  );
  const directId = chat.chatId;

  // повторно от A -> дедуп 200, тот же chatId
  res = await app.inject({
    method: 'POST',
    url: '/api/chats',
    headers: auth(a.token),
    payload: { type: 'direct', username: b.username },
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().chatId, directId);

  // от B к A -> тот же chatId (симметрично)
  res = await app.inject({
    method: 'POST',
    url: '/api/chats',
    headers: auth(b.token),
    payload: { type: 'direct', username: a.username },
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().chatId, directId);

  // direct с самим собой -> 400
  res = await app.inject({
    method: 'POST',
    url: '/api/chats',
    headers: auth(a.token),
    payload: { type: 'direct', username: a.username },
  });
  assert.equal(res.statusCode, 400);

  // неизвестный username -> 404
  res = await app.inject({
    method: 'POST',
    url: '/api/chats',
    headers: auth(a.token),
    payload: { type: 'direct', username: `nobody_${randomUUID()}` },
  });
  assert.equal(res.statusCode, 404);

  // GET /chats у A содержит чат
  res = await app.inject({ method: 'GET', url: '/api/chats', headers: auth(a.token) });
  assert.equal(res.statusCode, 200);
  assert.ok(
    res.json().chats.some((ch: { chatId: string }) => ch.chatId === directId),
  );

  // GET /chats/:id — A участник (200), C не участник (404)
  res = await app.inject({
    method: 'GET',
    url: `/api/chats/${directId}`,
    headers: auth(a.token),
  });
  assert.equal(res.statusCode, 200);
  res = await app.inject({
    method: 'GET',
    url: `/api/chats/${directId}`,
    headers: auth(c.token),
  });
  assert.equal(res.statusCode, 404);

  // группа с B и C -> 201, 3 участника
  res = await app.inject({
    method: 'POST',
    url: '/api/chats',
    headers: auth(a.token),
    payload: { type: 'group', title: 'G', members: [b.username, c.username] },
  });
  assert.equal(res.statusCode, 201);
  const group = res.json();
  assert.equal(group.type, 'group');
  assert.equal(group.title, 'G');
  assert.equal(group.participants.length, 3);

  // группа с неизвестным участником -> 400
  res = await app.inject({
    method: 'POST',
    url: '/api/chats',
    headers: auth(a.token),
    payload: { type: 'group', title: 'X', members: [`ghost_${randomUUID()}`] },
  });
  assert.equal(res.statusCode, 400);

  // неизвестный type -> 400
  res = await app.inject({
    method: 'POST',
    url: '/api/chats',
    headers: auth(a.token),
    payload: { type: 'weird' },
  });
  assert.equal(res.statusCode, 400);
});
