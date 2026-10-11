import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { createECDH, randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:https';
import type { IncomingMessage } from 'node:http';
import { resolve } from 'node:path';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const ece = require('http_ece') as {
  decrypt: (buf: Buffer, opts: Record<string, unknown>) => Buffer;
};
import { buildApp } from '../src/app';
import { pool } from '../src/db';
import { runMigrations } from '../src/migrate';
import { sendWakeUp } from '../src/push';
import { startEventListener } from '../src/ws';
import { auth, registerUser, TestUser } from './helpers';

// A fake push service plus a browser-side key pair, so the test can decrypt
// what the server sent exactly as the browser would (RFC 8291, aes128gcm).
// web-push speaks https only: the fixture serves a self-signed certificate
// (test/fixtures/push-tls.*, test-only), which this process accepts.
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
const TLS = {
  key: readFileSync(resolve(__dirname, 'fixtures/push-tls.key')),
  cert: readFileSync(resolve(__dirname, 'fixtures/push-tls.crt')),
};

const app = buildApp();
let listener: ReturnType<typeof startEventListener>;

before(async () => {
  await runMigrations();
  await app.ready();
  // NOTIFY → push goes through the same listener as WS delivery
  listener = startEventListener();
});

after(async () => {
  await listener.end();
  await app.close();
  await pool.end();
});

interface Received {
  headers: IncomingMessage['headers'];
  payload: Record<string, unknown>;
}

interface FakePushService {
  subscription: string; // PushSubscription JSON, as the browser would POST it
  received: Received[];
  setStatus: (code: number) => void;
  close: () => Promise<void>;
}

async function startPushService(): Promise<FakePushService> {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  const authSecret = randomBytes(16);
  const state = { status: 201 };
  const received: Received[] = [];
  const server = createServer(TLS, (req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const plain = ece.decrypt(Buffer.concat(chunks), {
        version: 'aes128gcm',
        privateKey: ecdh,
        authSecret: authSecret.toString('base64url'),
      });
      received.push({ headers: req.headers, payload: JSON.parse(plain.toString()) });
      res.writeHead(state.status);
      res.end(state.status < 300 ? '' : '{"reason":"Gone"}');
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as { port: number };
  return {
    subscription: JSON.stringify({
      endpoint: `https://127.0.0.1:${port}/push/${randomUUID()}`,
      keys: {
        p256dh: ecdh.getPublicKey().toString('base64url'),
        auth: authSecret.toString('base64url'),
      },
    }),
    received,
    setStatus: (code) => {
      state.status = code;
    },
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

async function subscribe(u: TestUser, endpoint: string) {
  return app.inject({
    method: 'POST',
    url: '/api/push/subscriptions',
    headers: auth(u.token),
    payload: { deviceId: u.deviceId, provider: 'webpush', endpoint },
  });
}

async function countSubs(deviceId: string): Promise<number> {
  const r = await pool.query(
    'SELECT count(*)::int AS c FROM push_subscriptions WHERE device_id = $1',
    [deviceId],
  );
  return r.rows[0].c;
}

test('webpush: VAPID public key is stable and needs auth', async () => {
  const u = await registerUser(app);
  const anon = await app.inject({ method: 'GET', url: '/api/push/vapid-public-key' });
  assert.equal(anon.statusCode, 401);
  const a = await app.inject({
    method: 'GET',
    url: '/api/push/vapid-public-key',
    headers: auth(u.token),
  });
  assert.equal(a.statusCode, 200);
  // uncompressed P-256 point, base64url
  assert.equal(Buffer.from(a.json().publicKey, 'base64url').length, 65);
  const b = await app.inject({
    method: 'GET',
    url: '/api/push/vapid-public-key',
    headers: auth(u.token),
  });
  assert.equal(b.json().publicKey, a.json().publicKey);
});

test('webpush: subscription must be a PushSubscription JSON', async () => {
  const u = await registerUser(app);
  const bad = await subscribe(u, 'https://web.push.apple.com/abc');
  assert.equal(bad.statusCode, 400);
  const ps = await startPushService();
  try {
    const ok = await subscribe(u, ps.subscription);
    assert.equal(ok.statusCode, 201);
  } finally {
    await ps.close();
  }
});

test('webpush: test notification reaches this device and reports the status', async () => {
  const ps = await startPushService();
  try {
    const u = await registerUser(app);

    // no push channel yet — the check runs, nothing to report
    const none = await app.inject({
      method: 'POST',
      url: '/api/push/test',
      headers: auth(u.token),
      payload: { deviceId: u.deviceId },
    });
    assert.equal(none.statusCode, 200);
    assert.deepEqual(none.json().results, []);

    await subscribe(u, ps.subscription);
    const res = await app.inject({
      method: 'POST',
      url: '/api/push/test',
      headers: auth(u.token),
      payload: { deviceId: u.deviceId, testId: 't-1', title: 'Проверка', body: 'Работает' },
    });
    assert.equal(res.statusCode, 200);
    const [r] = res.json().results;
    assert.equal(r.provider, 'webpush');
    assert.equal(r.success, true);
    assert.equal(r.statusCode, 201);

    assert.equal(ps.received.length, 1);
    assert.deepEqual(ps.received[0].payload, {
      type: 'test',
      testId: 't-1',
      title: 'Проверка',
      body: 'Работает',
    });
    assert.equal(ps.received[0].headers.urgency, 'high');
    assert.match(String(ps.received[0].headers.authorization), /^vapid t=/);
    assert.equal(ps.received[0].headers.topic, undefined);

    // the push service says the subscription is gone — reported and removed
    ps.setStatus(410);
    const gone = await app.inject({
      method: 'POST',
      url: '/api/push/test',
      headers: auth(u.token),
      payload: { deviceId: u.deviceId, testId: 't-2' },
    });
    const [g] = gone.json().results;
    assert.equal(g.success, false);
    assert.equal(g.statusCode, 410);
    assert.equal(g.removed, true);
    assert.equal(await countSubs(u.deviceId), 0);
  } finally {
    await ps.close();
  }
});

test('webpush: test notification only to your own device', async () => {
  const u = await registerUser(app);
  const other = await registerUser(app);
  const res = await app.inject({
    method: 'POST',
    url: '/api/push/test',
    headers: auth(u.token),
    payload: { deviceId: other.deviceId },
  });
  assert.equal(res.statusCode, 404);
});

test('webpush: a new message from someone else is pushed with its content', async () => {
  const ps = await startPushService();
  try {
    const alice = await registerUser(app);
    const bob = await registerUser(app);
    await subscribe(bob, ps.subscription);

    const chat = await app.inject({
      method: 'POST',
      url: '/api/chats',
      headers: auth(alice.token),
      payload: { type: 'direct', username: bob.username },
    });
    assert.ok(chat.statusCode < 300, chat.body);
    const chatId = chat.json().chatId;
    const ciphertext = Buffer.from(JSON.stringify({ text: 'привет' })).toString('base64');
    const sent = await app.inject({
      method: 'POST',
      url: `/api/chats/${chatId}/messages`,
      headers: auth(alice.token),
      payload: { clientMessageId: randomUUID(), ciphertext },
    });
    assert.equal(sent.statusCode, 201, sent.body);

    // delivery is asynchronous (NOTIFY → listener → push): wait for it
    for (let i = 0; i < 50 && ps.received.length === 0; i++) {
      await new Promise((r) => setTimeout(r, 100));
    }
    assert.equal(ps.received.length, 1, 'one push for the message, none for chat.created');
    assert.deepEqual(ps.received[0].payload, {
      type: 'message',
      chatId,
      messageId: sent.json().messageId,
      title: alice.username,
      sender: null,
      ciphertext,
      isReply: false,
    });

    // Bob's own events (e.g. his own message) produce no web push to himself.
    const before = ps.received.length;
    await sendWakeUp(bob.userId, undefined, chatId, {
      type: 'message.new',
      messageId: sent.json().messageId,
      senderId: bob.userId,
    });
    await sendWakeUp(bob.userId, undefined, chatId, { type: 'message.read' });
    assert.equal(ps.received.length, before);
  } finally {
    await ps.close();
  }
});
