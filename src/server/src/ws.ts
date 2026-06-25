import { FastifyInstance } from 'fastify';
import websocketPlugin from '@fastify/websocket';
import { Client } from 'pg';
import { config } from './config';
import { pool } from './db';
import { lookupSession } from './auth';
import { getMemberIds, isMember, markRead } from './chat-helpers';
import { sendWakeUp } from './push';

interface Conn {
  userId: string;
  send: (data: string) => void;
  lastSeq: string;
  draining: boolean;
  pending: boolean;
}

// Подключённые сокеты по аккаунту (одно WS-соединение на устройство, но
// устройств у аккаунта может быть несколько).
const byUser = new Map<string, Set<Conn>>();

// Онлайн = есть хотя бы один живой сокет аккаунта (in-process; одна реплика
// сервера). Бинарный статус, без «был в сети N назад».
export function isOnline(userId: string): boolean {
  const set = byUser.get(userId);
  return !!set && set.size > 0;
}

// Кому видна смена статуса userId — со-участникам (всем, с кем он делит хотя бы
// один чат). Транзиентно (мимо outbox) рассылаем тем из них, кто сейчас онлайн.
async function broadcastPresence(userId: string, online: boolean): Promise<void> {
  const res = await pool.query(
    `SELECT DISTINCT m2.user_id FROM chat_members m1
     JOIN chat_members m2 ON m2.chat_id = m1.chat_id
     WHERE m1.user_id = $1 AND m2.user_id <> $1`,
    [userId],
  );
  for (const r of res.rows) {
    sendTransient(r.user_id, {
      type: 'presence',
      payload: { userId, online },
    });
  }
}

function register(conn: Conn): void {
  let set = byUser.get(conn.userId);
  if (!set) {
    set = new Set();
    byUser.set(conn.userId, set);
  }
  const wasOffline = set.size === 0;
  set.add(conn);
  if (wasOffline) {
    void broadcastPresence(conn.userId, true).catch((err) =>
      console.error('presence online failed', err),
    );
  }
}

function unregister(conn: Conn): void {
  const set = byUser.get(conn.userId);
  if (!set) return;
  set.delete(conn);
  if (set.size === 0) {
    byUser.delete(conn.userId);
    void broadcastPresence(conn.userId, false).catch((err) =>
      console.error('presence offline failed', err),
    );
  }
}

// Доставляет получателю все события из outbox с seq > conn.lastSeq.
// Тот же путь используется и для replay по hello, и для живого fan-out.
async function drain(conn: Conn): Promise<void> {
  if (conn.draining) {
    conn.pending = true;
    return;
  }
  conn.draining = true;
  try {
    do {
      conn.pending = false;
      for (;;) {
        const res = await pool.query(
          `SELECT seq, type, chat_id, payload, created_at FROM events
           WHERE user_id = $1 AND seq > $2::bigint
           ORDER BY seq LIMIT 100`,
          [conn.userId, conn.lastSeq],
        );
        if (res.rowCount === 0) break;
        for (const r of res.rows) {
          const ev: Record<string, unknown> = {
            type: r.type,
            seq: Number(r.seq),
            ts: r.created_at.toISOString(),
            payload: r.payload,
          };
          if (r.chat_id) ev.chatId = r.chat_id;
          conn.send(JSON.stringify(ev));
          conn.lastSeq = r.seq;
        }
        if (res.rowCount! < 100) break;
      }
    } while (conn.pending);
  } finally {
    conn.draining = false;
  }
}

function notify(userId: string): void {
  const set = byUser.get(userId);
  if (set && set.size > 0) {
    for (const conn of set) void drain(conn);
    return;
  }
  // Нет живого WS у получателя — будим устройство пушем (без содержимого).
  // Клиент по wake-up переоткроет WS и досинхронизируется через hello/lastSeq.
  void sendWakeUp(userId).catch((err) => console.error('wake-up failed', err));
}

// Транзиентная отправка (typing) — мимо outbox, только подключённым сейчас.
function sendTransient(userId: string, obj: unknown): void {
  const set = byUser.get(userId);
  if (!set) return;
  const data = JSON.stringify(obj);
  for (const conn of set) conn.send(data);
}

// Отдельное долгоживущее соединение под LISTEN; будит доставку на каждый commit.
export function startEventListener(): Client {
  const client = new Client({ connectionString: config.databaseUrl });
  client.on('notification', (msg) => {
    if (msg.payload) notify(msg.payload);
  });
  client.on('error', (err) => console.error('event listener error', err));
  client
    .connect()
    .then(() => client.query('LISTEN alpha_events'))
    .catch((err) => console.error('LISTEN failed', err));
  return client;
}

interface ClientMessage {
  type?: string;
  token?: string;
  lastSeq?: unknown;
  chatId?: string;
  upToMessageId?: unknown;
}

export async function wsRoutes(app: FastifyInstance): Promise<void> {
  await app.register(websocketPlugin);

  app.get('/ws', { websocket: true }, (raw, _req) => {
    // защита от разницы версий @fastify/websocket: socket может быть сам ws
    // либо лежать в .socket
    const ws = (raw as { socket?: unknown }).socket ?? raw;
    const sock = ws as {
      send: (d: string) => void;
      close: () => void;
      on: (ev: string, cb: (data: Buffer) => void) => void;
    };

    let conn: Conn | null = null;

    sock.on('message', (data: Buffer) => {
      void (async () => {
        let msg: ClientMessage;
        try {
          msg = JSON.parse(data.toString());
        } catch {
          return;
        }

        if (!conn) {
          // первое сообщение обязано быть hello с токеном
          if (msg.type !== 'hello' || typeof msg.token !== 'string') {
            sock.close();
            return;
          }
          const session = await lookupSession(msg.token);
          if (!session) {
            sock.close();
            return;
          }
          const lastSeq =
            msg.lastSeq != null && /^\d+$/.test(String(msg.lastSeq))
              ? String(msg.lastSeq)
              : '0';
          conn = {
            userId: session.userId,
            send: (d) => sock.send(d),
            lastSeq,
            draining: false,
            pending: false,
          };
          register(conn);
          await drain(conn);
          // Граница реплея: всё выше — история из outbox, всё ниже — live.
          // Управляющий маркер без seq (не событие outbox): клиент по нему
          // отделяет «уже было» от «происходит сейчас».
          conn.send(
            JSON.stringify({
              type: 'synced',
              ts: new Date().toISOString(),
              payload: {},
            }),
          );
          return;
        }

        if (msg.type === 'typing' && typeof msg.chatId === 'string') {
          if (await isMember(msg.chatId, conn.userId)) {
            const members = await getMemberIds(pool, msg.chatId);
            for (const m of members) {
              if (m !== conn.userId) {
                sendTransient(m, {
                  type: 'typing',
                  chatId: msg.chatId,
                  payload: { userId: conn.userId },
                });
              }
            }
          }
        } else if (
          msg.type === 'read' &&
          typeof msg.chatId === 'string' &&
          /^\d+$/.test(String(msg.upToMessageId))
        ) {
          if (await isMember(msg.chatId, conn.userId)) {
            await markRead(conn.userId, msg.chatId, String(msg.upToMessageId));
          }
        }
      })();
    });

    sock.on('close', () => {
      if (conn) unregister(conn);
    });
    sock.on('error', () => {
      if (conn) unregister(conn);
    });
  });
}
