import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import WebSocket from 'ws';
import { Client } from 'pg';
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

test('ws: hello replay, live message.new, transient typing', async () => {
  const a = await registerUser(app);
  const b = await registerUser(app);
  const res = await app.inject({
    method: 'POST',
    url: '/chats',
    headers: auth(a.token),
    payload: { type: 'direct', username: b.username },
  });
  const chatId = res.json().chatId;

  // A подключается; hello реплеит бэклог (включая chat.created по этому чату)
  const wsA = await open();
  const replayed = nextMessage(
    wsA,
    (m) => m.type === 'chat.created' && m.chatId === chatId,
  );
  wsA.send(JSON.stringify({ type: 'hello', token: a.token, lastSeq: 0 }));
  const cc = await replayed;
  assert.ok(typeof cc.seq === 'number');

  // B шлёт сообщение -> A получает message.new вживую (через pg_notify -> LISTEN)
  const liveNew = nextMessage(
    wsA,
    (m) => m.type === 'message.new' && m.chatId === chatId,
  );
  await app.inject({
    method: 'POST',
    url: `/chats/${chatId}/messages`,
    headers: auth(b.token),
    payload: {
      clientMessageId: randomUUID(),
      ciphertext: Buffer.from('hi').toString('base64'),
    },
  });
  const nm = await liveNew;
  assert.equal(Buffer.from(nm.payload.ciphertext, 'base64').toString(), 'hi');
  assert.ok(typeof nm.seq === 'number');

  // B подключается и шлёт typing -> A получает транзиентный typing (без seq)
  const wsB = await open();
  const bHello = nextMessage(wsB, (m) => m.type === 'chat.created').catch(
    () => null,
  );
  wsB.send(JSON.stringify({ type: 'hello', token: b.token, lastSeq: 0 }));
  await bHello;

  const typing = nextMessage(
    wsA,
    (m) => m.type === 'typing' && m.chatId === chatId,
  );
  wsB.send(JSON.stringify({ type: 'typing', chatId }));
  const tp = await typing;
  assert.equal(tp.payload.userId, b.userId);
  assert.equal(tp.seq, undefined);

  wsA.close();
  wsB.close();
});
