import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import WebSocket from 'ws';
import type { Client } from 'pg';
import { buildApp } from '../src/app';
import { pool } from '../src/db';
import { runMigrations } from '../src/migrate';
import { startEventListener } from '../src/ws';
import { auth, registerUser } from './helpers';

const app = buildApp();
let listener: Client;
let wsUrl: string;

before(async () => {
  await runMigrations();
  listener = startEventListener();
  await app.listen({ port: 0, host: '127.0.0.1' });
  const addr = app.server.address() as AddressInfo;
  wsUrl = `ws://127.0.0.1:${addr.port}/ws`;
});

after(async () => {
  await app.close();
  await listener.end();
  await pool.end();
});

const b64 = (s: string): string => Buffer.from(s).toString('base64');

async function createDirect(token: string, username: string): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/chats',
    headers: auth(token),
    payload: { type: 'direct', username },
  });
  assert.equal(res.statusCode, 201);
  return res.json().chatId;
}

async function send(token: string, chatId: string, text: string): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: `/api/chats/${chatId}/messages`,
    headers: auth(token),
    payload: { clientMessageId: randomUUID(), ciphertext: b64(text) },
  });
  assert.equal(res.statusCode, 201);
  return res.json().messageId;
}

function pin(token: string, chatId: string, messageId?: string) {
  return app.inject({
    method: 'PUT',
    url: `/api/chats/${chatId}/pin`,
    headers: auth(token),
    payload: messageId === undefined ? {} : { messageId },
  });
}

function unpin(token: string, chatId: string) {
  return app.inject({
    method: 'DELETE',
    url: `/api/chats/${chatId}/pin`,
    headers: auth(token),
  });
}

// pinnedMessageId чата из списка чатов (ChatView).
async function pinnedInList(token: string, chatId: string): Promise<string | null> {
  const res = await app.inject({ method: 'GET', url: '/api/chats', headers: auth(token) });
  assert.equal(res.statusCode, 200);
  const chat = res.json().chats.find((ch: { chatId: string }) => ch.chatId === chatId);
  return chat.pinnedMessageId ?? null;
}

function open(): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    ws.once('open', () => resolve(ws));
    ws.once('error', reject);
  });
}

function nextMessage(
  ws: WebSocket,
  predicate: (m: any) => boolean,
  timeoutMs = 3000,
): Promise<any> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.off('message', onMsg);
      reject(new Error('timeout waiting for ws message'));
    }, timeoutMs);
    function onMsg(raw: WebSocket.RawData): void {
      let m: any;
      try {
        m = JSON.parse(raw.toString());
      } catch {
        return;
      }
      if (predicate(m)) {
        clearTimeout(timer);
        ws.off('message', onMsg);
        resolve(m);
      }
    }
    ws.on('message', onMsg);
  });
}

test('pin/unpin: validation, access control, chat view, outbox events', async () => {
  const a = await registerUser(app);
  const b = await registerUser(app);
  const c = await registerUser(app);
  const chatId = await createDirect(a.token, b.username);
  const m1 = await send(a.token, chatId, 'first');
  const m2 = await send(a.token, chatId, 'second');

  // без токена -> 401
  let res = await app.inject({
    method: 'PUT',
    url: `/api/chats/${chatId}/pin`,
    payload: { messageId: m1 },
  });
  assert.equal(res.statusCode, 401);

  // невалидный messageId -> 400: отсутствует и не число
  res = await pin(a.token, chatId);
  assert.equal(res.statusCode, 400);
  res = await pin(a.token, chatId, 'abc');
  assert.equal(res.statusCode, 400);

  // не-участник C -> 404
  res = await pin(c.token, chatId, m1);
  assert.equal(res.statusCode, 404);

  // несуществующее сообщение -> 404
  res = await pin(a.token, chatId, '999999999999');
  assert.equal(res.statusCode, 404);

  // сообщение из другого чата -> 404
  const otherChat = await createDirect(a.token, c.username);
  const otherMsg = await send(a.token, otherChat, 'other');
  res = await pin(a.token, chatId, otherMsg);
  assert.equal(res.statusCode, 404);

  // B закрепляет чужое сообщение (в direct может любой участник)
  res = await pin(b.token, chatId, m1);
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().pinnedMessageId, m1);

  // закрепление видно обоим участникам в списке чатов
  assert.equal(await pinnedInList(a.token, chatId), m1);
  assert.equal(await pinnedInList(b.token, chatId), m1);

  // повторное закрепление заменяет сообщение
  res = await pin(b.token, chatId, m2);
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().pinnedMessageId, m2);

  // события chat.pinned в outbox: по строке на каждого участника на каждый pin
  const ev = await pool.query(
    `SELECT user_id, payload FROM events
     WHERE chat_id = $1 AND type = 'chat.pinned' ORDER BY seq`,
    [chatId],
  );
  assert.equal(ev.rows.length, 4);
  assert.deepEqual(
    ev.rows.slice(0, 2).map((r: any) => r.payload.pinnedMessageId),
    [m1, m1],
  );
  assert.deepEqual(
    ev.rows.slice(2).map((r: any) => r.payload.pinnedMessageId),
    [m2, m2],
  );
  const last = ev.rows[ev.rows.length - 1].payload;
  assert.equal(last.chatId, chatId);
  assert.equal(last.byUserId, b.userId);
  const recipients = [...new Set(ev.rows.map((r: any) => r.user_id))].sort();
  assert.deepEqual(recipients, [a.userId, b.userId].sort());

  // открепить C не может -> 404
  res = await unpin(c.token, chatId);
  assert.equal(res.statusCode, 404);

  // открепление B -> 200, pinnedMessageId null
  res = await unpin(b.token, chatId);
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().pinnedMessageId, null);
  assert.equal(await pinnedInList(a.token, chatId), null);

  // повторное открепление идемпотентно
  res = await unpin(b.token, chatId);
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().pinnedMessageId, null);

  // удалённое сообщение закрепить нельзя
  res = await app.inject({
    method: 'DELETE',
    url: `/api/messages/${m2}`,
    headers: auth(a.token),
  });
  assert.equal(res.statusCode, 200);
  res = await pin(a.token, chatId, m2);
  assert.equal(res.statusCode, 404);

  // последнее unpin-событие несёт pinnedMessageId = null
  const ev2 = await pool.query(
    `SELECT payload FROM events
     WHERE chat_id = $1 AND type = 'chat.pinned'
     ORDER BY seq DESC LIMIT 1`,
    [chatId],
  );
  assert.equal(ev2.rows[0].payload.pinnedMessageId, null);
});

test('pin in group: any member pins, live chat.pinned over WS', async () => {
  const a = await registerUser(app);
  const b = await registerUser(app);
  const c = await registerUser(app);
  let res = await app.inject({
    method: 'POST',
    url: '/api/chats',
    headers: auth(a.token),
    payload: { type: 'group', title: 'G', members: [b.username, c.username] },
  });
  assert.equal(res.statusCode, 201);
  const chatId = res.json().chatId;
  const m = await send(b.token, chatId, 'hello');

  // B подключается по WS; hello реплеит бэклог группы
  const wsB = await open();
  const backlogged = nextMessage(
    wsB,
    (x) => x.type === 'chat.created' && x.chatId === chatId,
  ).catch(() => null);
  wsB.send(JSON.stringify({ type: 'hello', token: b.token, lastSeq: 0 }));
  await backlogged;

  // A закрепляет сообщение B -> live-событие chat.pinned
  const livePinned = nextMessage(
    wsB,
    (x) => x.type === 'chat.pinned' && x.chatId === chatId,
  );
  res = await pin(a.token, chatId, m);
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().pinnedMessageId, m);

  const pev = await livePinned;
  assert.ok(typeof pev.seq === 'number');
  assert.equal(pev.payload.chatId, chatId);
  assert.equal(pev.payload.pinnedMessageId, m);
  assert.equal(pev.payload.byUserId, a.userId);

  // участник C видит закрепление через GET /chats/:id
  res = await app.inject({
    method: 'GET',
    url: `/api/chats/${chatId}`,
    headers: auth(c.token),
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().pinnedMessageId, m);

  wsB.close();
});
