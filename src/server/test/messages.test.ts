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

const b64 = (s: string): string => Buffer.from(s).toString('base64');
const fromB64 = (s: string): string => Buffer.from(s, 'base64').toString('utf8');

async function createDirect(token: string, username: string): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/chats',
    headers: auth(token),
    payload: { type: 'direct', username },
  });
  return res.json().chatId;
}

test('send (idempotent), list+paginate, unread/read, edit, delete, access', async () => {
  const a = await registerUser(app);
  const b = await registerUser(app);
  const c = await registerUser(app);
  const chatId = await createDirect(a.token, b.username);

  // A отправляет сообщение
  const cmid = randomUUID();
  let res = await app.inject({
    method: 'POST',
    url: `/api/chats/${chatId}/messages`,
    headers: auth(a.token),
    payload: { clientMessageId: cmid, ciphertext: b64('hello') },
  });
  assert.equal(res.statusCode, 201);
  const messageId = res.json().messageId;
  assert.ok(messageId);

  // идемпотентность: тот же clientMessageId -> 200, тот же messageId
  res = await app.inject({
    method: 'POST',
    url: `/api/chats/${chatId}/messages`,
    headers: auth(a.token),
    payload: { clientMessageId: cmid, ciphertext: b64('hello') },
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().messageId, messageId);

  // не-участник C не может писать/читать -> 404
  res = await app.inject({
    method: 'POST',
    url: `/api/chats/${chatId}/messages`,
    headers: auth(c.token),
    payload: { clientMessageId: randomUUID(), ciphertext: b64('x') },
  });
  assert.equal(res.statusCode, 404);
  res = await app.inject({
    method: 'GET',
    url: `/api/chats/${chatId}/messages`,
    headers: auth(c.token),
  });
  assert.equal(res.statusCode, 404);

  // B читает историю -> 1 сообщение, расшифровывается
  res = await app.inject({
    method: 'GET',
    url: `/api/chats/${chatId}/messages`,
    headers: auth(b.token),
  });
  assert.equal(res.statusCode, 200);
  const list = res.json();
  assert.equal(list.messages.length, 1);
  assert.equal(fromB64(list.messages[0].ciphertext), 'hello');

  // у B unreadCount = 1, lastMessage не null
  res = await app.inject({ method: 'GET', url: '/api/chats', headers: auth(b.token) });
  let chat = res.json().chats.find((ch: { chatId: string }) => ch.chatId === chatId);
  assert.equal(chat.unreadCount, 1);
  assert.ok(chat.lastMessage);

  // B отмечает прочтение -> unreadCount 0
  res = await app.inject({
    method: 'POST',
    url: `/api/chats/${chatId}/read`,
    headers: auth(b.token),
    payload: { upToMessageId: messageId },
  });
  assert.equal(res.statusCode, 200);
  res = await app.inject({ method: 'GET', url: '/api/chats', headers: auth(b.token) });
  chat = res.json().chats.find((ch: { chatId: string }) => ch.chatId === chatId);
  assert.equal(chat.unreadCount, 0);

  // A редактирует своё сообщение
  res = await app.inject({
    method: 'PATCH',
    url: `/api/messages/${messageId}`,
    headers: auth(a.token),
    payload: { ciphertext: b64('hi') },
  });
  assert.equal(res.statusCode, 200);
  assert.ok(res.json().editedAt);

  res = await app.inject({
    method: 'GET',
    url: `/api/chats/${chatId}/messages`,
    headers: auth(b.token),
  });
  const edited = res.json().messages[0];
  assert.equal(fromB64(edited.ciphertext), 'hi');
  assert.ok(edited.editedAt);

  // B не может редактировать чужое -> 403
  res = await app.inject({
    method: 'PATCH',
    url: `/api/messages/${messageId}`,
    headers: auth(b.token),
    payload: { ciphertext: b64('nope') },
  });
  assert.equal(res.statusCode, 403);

  // пагинация: A отправляет ещё 2 сообщения (всего 3)
  for (const text of ['m2', 'm3']) {
    await app.inject({
      method: 'POST',
      url: `/api/chats/${chatId}/messages`,
      headers: auth(a.token),
      payload: { clientMessageId: randomUUID(), ciphertext: b64(text) },
    });
  }
  res = await app.inject({
    method: 'GET',
    url: `/api/chats/${chatId}/messages?limit=2`,
    headers: auth(b.token),
  });
  let page = res.json();
  assert.equal(page.messages.length, 2);
  assert.equal(page.hasMore, true);
  assert.ok(page.nextBefore);

  res = await app.inject({
    method: 'GET',
    url: `/api/chats/${chatId}/messages?limit=2&before=${page.nextBefore}`,
    headers: auth(b.token),
  });
  page = res.json();
  assert.equal(page.messages.length, 1);
  assert.equal(page.hasMore, false);

  // A удаляет своё сообщение
  res = await app.inject({
    method: 'DELETE',
    url: `/api/messages/${messageId}`,
    headers: auth(a.token),
  });
  assert.equal(res.statusCode, 200);

  res = await app.inject({
    method: 'GET',
    url: `/api/chats/${chatId}/messages`,
    headers: auth(b.token),
  });
  const delMsg = res
    .json()
    .messages.find((m: { messageId: string }) => m.messageId === messageId);
  assert.equal(delMsg.deleted, true);
  assert.equal(delMsg.ciphertext, '');

  // события записаны в outbox
  const ev = await pool.query(
    'SELECT DISTINCT type FROM events WHERE chat_id = $1',
    [chatId],
  );
  const types = ev.rows.map((r: { type: string }) => r.type);
  for (const t of ['message.new', 'message.edited', 'message.deleted', 'message.read']) {
    assert.ok(types.includes(t), `missing event ${t}`);
  }
});
