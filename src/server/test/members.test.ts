import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
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

test('members list, creator, removal permissions', async () => {
  const a = await registerUser(app); // создатель
  const b = await registerUser(app);
  const c = await registerUser(app);
  const d = await registerUser(app); // не участник

  // A создаёт группу с B и C
  let res = await app.inject({
    method: 'POST',
    url: '/api/chats',
    headers: auth(a.token),
    payload: { type: 'group', title: 'G', members: [b.username, c.username] },
  });
  assert.equal(res.statusCode, 201);
  const group = res.json();
  assert.equal(group.createdBy, a.userId);
  const chatId = group.chatId;

  // GET members у участника — 200, создатель A, 3 участника, поле online
  res = await app.inject({
    method: 'GET',
    url: `/api/chats/${chatId}/members`,
    headers: auth(a.token),
  });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.equal(body.createdBy, a.userId);
  assert.equal(body.members.length, 3);
  assert.equal(typeof body.members[0].online, 'boolean');

  // GET members у не-участника D — 404
  res = await app.inject({
    method: 'GET',
    url: `/api/chats/${chatId}/members`,
    headers: auth(d.token),
  });
  assert.equal(res.statusCode, 404);

  // C (не создатель) пытается удалить B — 403
  res = await app.inject({
    method: 'DELETE',
    url: `/api/chats/${chatId}/members/${b.userId}`,
    headers: auth(c.token),
  });
  assert.equal(res.statusCode, 403);

  // A пытается удалить самого себя (создателя) — 400
  res = await app.inject({
    method: 'DELETE',
    url: `/api/chats/${chatId}/members/${a.userId}`,
    headers: auth(a.token),
  });
  assert.equal(res.statusCode, 400);

  // A (создатель) удаляет B — 200
  res = await app.inject({
    method: 'DELETE',
    url: `/api/chats/${chatId}/members/${b.userId}`,
    headers: auth(a.token),
  });
  assert.equal(res.statusCode, 200);

  // теперь участников 2, B нет
  res = await app.inject({
    method: 'GET',
    url: `/api/chats/${chatId}/members`,
    headers: auth(a.token),
  });
  assert.equal(res.json().members.length, 2);
  assert.ok(
    !res
      .json()
      .members.some((m: { userId: string }) => m.userId === b.userId),
  );

  // у B группа исчезла из списка чатов
  res = await app.inject({
    method: 'GET',
    url: '/api/chats',
    headers: auth(b.token),
  });
  assert.ok(
    !res.json().chats.some((ch: { chatId: string }) => ch.chatId === chatId),
  );

  // повторное удаление B — 404 (уже не участник)
  res = await app.inject({
    method: 'DELETE',
    url: `/api/chats/${chatId}/members/${b.userId}`,
    headers: auth(a.token),
  });
  assert.equal(res.statusCode, 404);

  // удаление из direct-чата — 400 (не группа)
  res = await app.inject({
    method: 'POST',
    url: '/api/chats',
    headers: auth(a.token),
    payload: { type: 'direct', username: c.username },
  });
  const directId = res.json().chatId;
  res = await app.inject({
    method: 'DELETE',
    url: `/api/chats/${directId}/members/${c.userId}`,
    headers: auth(a.token),
  });
  assert.equal(res.statusCode, 400);
});

test('presence endpoint returns array', async () => {
  const a = await registerUser(app);
  const res = await app.inject({
    method: 'GET',
    url: '/api/presence',
    headers: auth(a.token),
  });
  assert.equal(res.statusCode, 200);
  assert.ok(Array.isArray(res.json().online));
});
