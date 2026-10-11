// Service worker: Web Push notifications (see src/notifications/webpush.ts).
//
// Plain JS outside the bundle on purpose: it must live at a stable URL (the
// browser keeps the registration by it) at the root of the client.
//
// Rules the code below keeps:
//  * Every push ends in a visible notification. Safari (iOS) revokes the
//    subscription of a worker that receives pushes without showing one, and
//    Chrome shows a generic "site updated in background" instead.
//  * The server sends the same opaque ciphertext the WS would deliver; the
//    worker decodes it the way util/content.ts does (v1: base64 of UTF-8 JSON).
//    Anything unexpected falls back to "New message" rather than failing.
//  * No fetch handler: the worker adds no offline caching, the network
//    behaviour of the app is unchanged.

const CACHE = 'alpha-sw'; // same as in webpush.ts
const STRINGS_URL = new URL('sw-strings.json', self.registration.scope).href;

const DEFAULT_STRINGS = {
  newMessage: 'New message',
  repliedTo: 'Replied to your message: {{text}}',
  sticker: '🎯 Sticker',
  voice: '🎤 Voice message',
  video: '🎥 Video',
  photo: '📷 Photo',
};

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

async function loadStrings() {
  try {
    const cache = await caches.open(CACHE);
    const res = await cache.match(STRINGS_URL);
    if (res) return { ...DEFAULT_STRINGS, ...(await res.json()) };
  } catch {
    /* fall back to English */
  }
  return DEFAULT_STRINGS;
}

function decodeBase64Utf8(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

// Short preview of a message body, like previewText() in util/content.ts.
function previewText(ciphertext, s) {
  if (!ciphertext) return '';
  let raw;
  try {
    raw = decodeBase64Utf8(ciphertext);
  } catch {
    return '';
  }
  let o;
  try {
    o = JSON.parse(raw);
  } catch {
    return raw; // legacy plain text
  }
  if (!o || typeof o !== 'object') return raw;
  if (o.t === 'text' && typeof o.text === 'string') return o.text;
  if (o.t === 'image') return o.cap ? `📷 ${o.cap}` : s.photo;
  if (o.t !== 'msg') return '';
  const text = typeof o.text === 'string' ? o.text : '';
  const atts = Array.isArray(o.atts) ? o.atts : [];
  const has = (k) => atts.find((a) => a && a.k === k);
  if (has('sticker')) return s.sticker;
  if (has('audio')) return s.voice;
  if (has('video')) return s.video;
  const file = has('file');
  if (file) return `📎 ${file.name || ''}`.trim();
  const img = atts.find((a) => a && (a.k === 'image' || a.k === undefined));
  if (img) {
    const cap = img.cap || text;
    return cap ? `📷 ${cap}` : s.photo;
  }
  return text;
}

async function postToClients(message) {
  const list = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  for (const c of list) c.postMessage(message);
}

async function handlePush(data) {
  if (data.type === 'test') {
    // Tell the page that pressed "check notifications" that it arrived.
    await postToClients({ type: 'push-test-received', testId: data.testId });
    await self.registration.showNotification(data.title, {
      body: data.body,
      tag: `test-${data.testId}`,
      icon: 'icons/icon-192.png',
      data: {},
    });
    return;
  }
  const s = await loadStrings();
  if (data.type === 'message') {
    let body = previewText(data.ciphertext, s) || s.newMessage;
    if (data.isReply) body = s.repliedTo.replace('{{text}}', body);
    if (data.sender) body = `${data.sender}: ${body}`;
    await self.registration.showNotification(data.title || s.newMessage, {
      body,
      // One notification per message (Telegram shows each), but a redelivered
      // push of the same message replaces its own.
      tag: `msg-${data.messageId}`,
      icon: 'icons/icon-192.png',
      data: { chatId: data.chatId },
    });
    return;
  }
  await self.registration.showNotification(s.newMessage, { icon: 'icons/icon-192.png', data: {} });
}

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = {};
  }
  event.waitUntil(
    handlePush(data).catch(() =>
      self.registration.showNotification(DEFAULT_STRINGS.newMessage, { data: {} }),
    ),
  );
});

// Click: focus an open window of the app and let it open the chat; otherwise
// open a new one with the chat in the URL (?chat=<id>, read by HomeScreen).
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const chatId = event.notification.data && event.notification.data.chatId;
  event.waitUntil(
    (async () => {
      const list = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const win = list[0];
      if (win) {
        if (chatId) win.postMessage({ type: 'open-chat', chatId });
        try {
          await win.focus();
          return;
        } catch {
          /* focus not allowed — open below */
        }
      }
      const url = new URL(self.registration.scope);
      if (chatId) url.searchParams.set('chat', chatId);
      await self.clients.openWindow(url.href);
    })(),
  );
});
