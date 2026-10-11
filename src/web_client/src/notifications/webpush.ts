// Web Push for the browser and the installed PWA (iOS home screen app included).
//
// Why it exists: a page shows notifications only while its JS runs. iOS freezes
// a backgrounded home screen app within seconds and never runs it in the
// background, so the WS-driven notifications (util/notifications.ts) can't reach
// an iPhone at all. A service worker (public/sw.js) subscribed to Web Push is
// woken by the push service and draws the notification itself.
//
// Flow: register sw.js → once notification permission is granted, subscribe
// pushManager with the server's VAPID key → hand the subscription to the server
// (provider 'webpush'). Re-run on every start: the browser may have recreated
// the subscription, or the server may have dropped it (404/410/403 from the
// push service) — the POST is an upsert, so repeating it is harmless.
//
// Not used inside Electron / Capacitor: they have native notifications and push.

import { rest } from '../api/rest';
import { getDeviceId } from '../api/session';
import { getPlatform } from '../util/platform';
import i18n from '../i18n';

const SUB_ID_KEY = 'alpha.webpush.subscriptionId';
// Strings the worker needs to draw a notification in the UI language
// (it has no i18n of its own). Same cache name/key as in public/sw.js.
const SW_CACHE = 'alpha-sw';
const SW_STRINGS_URL = 'sw-strings.json';

let registration: Promise<ServiceWorkerRegistration | null> | null = null;

// Root of the deployed client (where sw.js lies). Not the page URL: with
// base './' a page may be served on a deeper path. A production chunk sits in
// <root>/assets/, the dev server serves from '/'.
function appRoot(): string {
  return import.meta.env.DEV
    ? new URL('/', window.location.href).href
    : new URL('../', import.meta.url).href;
}

function isWebPlatform(): boolean {
  return getPlatform() === 'web';
}

export function serviceWorkerSupported(): boolean {
  return isWebPlatform() && typeof navigator !== 'undefined' && 'serviceWorker' in navigator;
}

export function webPushSupported(): boolean {
  return serviceWorkerSupported() && typeof window !== 'undefined' && 'PushManager' in window;
}

// iOS gives Web Push only to a home screen app, never to a Safari tab.
export function isIos(): boolean {
  const ua = navigator.userAgent;
  return /iPhone|iPad|iPod/.test(ua) || (ua.includes('Macintosh') && navigator.maxTouchPoints > 1);
}

// Phone / tablet: no fine pointer at all. Laptops with touch screens keep a
// mouse/touchpad and count as desktop.
export function isTouchOnlyDevice(): boolean {
  return (
    !!window.matchMedia &&
    window.matchMedia('(pointer: coarse)').matches &&
    !window.matchMedia('(any-pointer: fine)').matches
  );
}

// Where page notifications (new Notification) don't work and only the
// worker's showNotification does.
export function preferWorkerNotifications(): boolean {
  return isIos() || isTouchOnlyDevice();
}

export function isStandalone(): boolean {
  return (
    window.matchMedia?.('(display-mode: standalone)').matches ||
    (navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

// Registers sw.js once per page. Resolves to null where workers are
// unavailable (Electron, Capacitor, http without a secure context).
export function getRegistration(): Promise<ServiceWorkerRegistration | null> {
  if (!registration) {
    registration = serviceWorkerSupported()
      ? navigator.serviceWorker
          .register(new URL('sw.js', appRoot()).href, { scope: appRoot() })
          .then(() => navigator.serviceWorker.ready)
          .catch((err) => {
            console.warn('Alpha: service worker registration failed', err);
            return null;
          })
      : Promise.resolve(null);
  }
  return registration;
}

function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padded = (base64 + '='.repeat((4 - (base64.length % 4)) % 4))
    .replace(/-/g, '+')
    .replace(/_/g, '/');
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
}

function sameKey(a: ArrayBuffer | null, b: Uint8Array<ArrayBuffer>): boolean {
  if (!a) return false;
  const x = new Uint8Array(a);
  return x.length === b.length && x.every((v, i) => v === b[i]);
}

// Puts the UI strings where the worker reads them. Called on start and on
// language change, so pushes are drawn in the current language.
export async function publishWorkerStrings(): Promise<void> {
  if (!serviceWorkerSupported() || typeof caches === 'undefined') return;
  const strings = {
    newMessage: i18n.t('common.newMessage'),
    repliedTo: i18n.t('notif.repliedTo', { text: '{{text}}' }),
    sticker: `🎯 ${i18n.t('preview.sticker')}`,
    voice: `🎤 ${i18n.t('preview.voice')}`,
    video: `🎥 ${i18n.t('preview.video')}`,
    photo: `📷 ${i18n.t('preview.photo')}`,
  };
  try {
    const cache = await caches.open(SW_CACHE);
    await cache.put(
      new URL(SW_STRINGS_URL, appRoot()).href,
      new Response(JSON.stringify(strings), {
        headers: { 'content-type': 'application/json' },
      }),
    );
  } catch {
    /* not critical: the worker falls back to English */
  }
}

export type WebPushState =
  | 'unsupported' // no service worker / PushManager here
  | 'needs-install' // iOS Safari tab: add to the home screen first
  | 'no-permission' // permission not granted (yet)
  | 'subscribed'
  | 'failed';

// Makes sure this browser is subscribed and the server knows the subscription.
// Never asks for permission (that needs a user gesture — the caller does it).
export async function syncWebPush(): Promise<WebPushState> {
  if (!webPushSupported()) return isIos() && !isStandalone() ? 'needs-install' : 'unsupported';
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') {
    return 'no-permission';
  }
  try {
    const reg = await getRegistration();
    if (!reg) return 'unsupported';
    void publishWorkerStrings();
    const { publicKey } = await rest.get<{ publicKey: string }>('/push/vapid-public-key');
    const key = urlBase64ToUint8Array(publicKey);
    let sub = await reg.pushManager.getSubscription();
    // Made under another key (the server's key was rotated) — the push service
    // would refuse our pushes with 403: recreate.
    if (sub && !sameKey(sub.options.applicationServerKey, key)) {
      await sub.unsubscribe().catch(() => undefined);
      sub = null;
    }
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: key,
      });
    }
    const res = await rest.post<{ subscriptionId: string }>('/push/subscriptions', {
      deviceId: getDeviceId(),
      provider: 'webpush',
      endpoint: JSON.stringify(sub.toJSON()),
    });
    localStorage.setItem(SUB_ID_KEY, res.subscriptionId);
    return 'subscribed';
  } catch (err) {
    console.warn('Alpha: web push subscription failed', err);
    return 'failed';
  }
}

// Stops pushes to this browser: notifications switched off, or logout.
export async function disableWebPush(): Promise<void> {
  const subId = localStorage.getItem(SUB_ID_KEY);
  localStorage.removeItem(SUB_ID_KEY);
  if (subId) {
    await rest.del(`/push/subscriptions/${subId}`).catch(() => undefined);
  }
  if (!webPushSupported()) return;
  try {
    const reg = await navigator.serviceWorker.getRegistration(appRoot());
    const sub = await reg?.pushManager.getSubscription();
    await sub?.unsubscribe();
  } catch {
    /* nothing to undo */
  }
}

export function webPushActive(): boolean {
  return localStorage.getItem(SUB_ID_KEY) !== null;
}

// --- Notification check ---

export interface PushTestServerResult {
  subscriptionId: string;
  provider: string;
  success: boolean;
  statusCode?: number;
  message?: string;
  removed: boolean;
}

export interface PushTestOutcome {
  state: WebPushState | 'native'; // what syncWebPush said before the test
  results: PushTestServerResult[]; // what the push services answered
  received: boolean | null; // the worker got it (null: can't tell on this platform)
}

const RECEIVE_TIMEOUT_MS = 20_000;

// Waits for the worker to report that the test push with this id arrived.
function waitForReceipt(testId: string, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const onMessage = (e: MessageEvent): void => {
      const d = e.data as { type?: string; testId?: string } | null;
      if (d?.type === 'push-test-received' && d.testId === testId) {
        cleanup();
        resolve(true);
      }
    };
    const timer = setTimeout(() => {
      cleanup();
      resolve(false);
    }, timeoutMs);
    function cleanup(): void {
      clearTimeout(timer);
      navigator.serviceWorker.removeEventListener('message', onMessage);
    }
    navigator.serviceWorker.addEventListener('message', onMessage);
  });
}

// The "check notifications" button: (re)subscribes this device, asks the server
// to push a test notification to it and reports both halves — whether the push
// service accepted it, and whether it actually came back to this device.
export async function runPushTest(): Promise<PushTestOutcome> {
  const native = !isWebPlatform();
  const state = native ? 'native' : await syncWebPush();
  if (state !== 'native' && state !== 'subscribed') {
    return { state, results: [], received: null };
  }
  const testId = crypto.randomUUID();
  const receipt = native ? null : waitForReceipt(testId, RECEIVE_TIMEOUT_MS);
  const { results } = await rest.post<{ results: PushTestServerResult[] }>('/push/test', {
    deviceId: getDeviceId(),
    testId,
    title: i18n.t('pushTest.notifTitle'),
    body: i18n.t('pushTest.notifBody'),
  });
  if (!receipt || !results.some((r) => r.success)) {
    return { state, results, received: receipt ? false : null };
  }
  return { state, results, received: await receipt };
}
