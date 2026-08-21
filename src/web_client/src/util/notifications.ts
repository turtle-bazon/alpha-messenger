// New message notifications (known issue #8). Three mechanisms:
//  (a) browser notification — a system notification if permitted;
//  (b) unread counter in the tab title — "(3) alpha";
//  (c) short sound on a new message while the tab is inactive.
// Settings (sound / browser notifications) are stored in localStorage,
// everything enabled by default. Sound and popup fire only when the user isn't
// looking at the tab (like Telegram Web) — with an active tab the badge in the
// title and the counter in the chat list suffice; notifications for own and
// replayed events are filtered out by the caller.

import { decodeContent, previewText } from './content';
import i18n from '../i18n';

export interface NotifPrefs {
  sound: boolean;
  browser: boolean;
}

const SOUND_KEY = 'alpha.notif.sound';
const BROWSER_KEY = 'alpha.notif.browser';

// Default is enabled: disabling stores an explicit '0', missing key = on.
function readFlag(key: string): boolean {
  return localStorage.getItem(key) !== '0';
}

export function getNotifPrefs(): NotifPrefs {
  return { sound: readFlag(SOUND_KEY), browser: readFlag(BROWSER_KEY) };
}

export function setNotifSound(on: boolean): void {
  localStorage.setItem(SOUND_KEY, on ? '1' : '0');
}

export function setNotifBrowser(on: boolean): void {
  localStorage.setItem(BROWSER_KEY, on ? '1' : '0');
}

// Explicit initialization of defaults on entry (known issues #29 and #30).
// Previously a missing key implicitly meant "enabled", so after clearing
// localStorage there were no keys at all. Now defaults are written explicitly —
// both '1'.
//
// Important (issue #30): the browser default is ALWAYS '1', regardless of the
// current Notification.permission. The old reliance on denied was wrong:
// getPermission() returns 'denied' not only when the user actually blocked
// notifications, but also when the Notification API is unavailable (old browser,
// http without secure-context). In such environments the default wrongly became
// '0'. Now with denied the setting stays enabled ('1'), and the UI toggle shows
// as enabled but locked (like Telegram); ensureBrowserPermission() with denied
// simply does nothing (doesn't ask). Idempotent: an explicit choice is not overwritten.
export function initNotifDefaults(): void {
  if (localStorage.getItem(SOUND_KEY) === null) setNotifSound(true);
  if (localStorage.getItem(BROWSER_KEY) === null) setNotifBrowser(true);
}

// The user has already made a notification settings choice (opened the menu or
// pressed a banner button at least once). No key means first visit.
export function hasNotifPref(): boolean {
  return localStorage.getItem(BROWSER_KEY) !== null;
}

// Notification API support may be absent (old browser, http without
// secure-context) — treat permission as unavailable then.
export function notificationsSupported(): boolean {
  return typeof Notification !== 'undefined';
}

export function getPermission(): NotificationPermission {
  return notificationsSupported() ? Notification.permission : 'denied';
}

export async function requestPermission(): Promise<NotificationPermission> {
  if (!notificationsSupported()) return 'denied';
  try {
    return await Notification.requestPermission();
  } catch {
    return getPermission();
  }
}

// Proactive permission request on entry. Per spec, browser popups show only
// when granted, and a new user has permission='default'. Since browser
// notifications are enabled by default, ask for system permission right away —
// so popups work out of the box without visiting settings. If permission is
// already granted/denied — do nothing.
export async function ensureBrowserPermission(): Promise<void> {
  // In Capacitor, request native POST_NOTIFICATIONS permission
  const cap = (window as any).Capacitor;
  if (cap?.isNativePlatform?.() && cap?.Plugins?.AlphaNotification) {
    await cap.Plugins.AlphaNotification.requestPermission();
    // Request exemption from battery optimization (Griffin/Doze)
    await cap.Plugins.AlphaNotification.requestIgnoreBatteryOptimizations();
    return;
  }
  if (!notificationsSupported()) return;
  if (!getNotifPrefs().browser) return;
  if (Notification.permission !== 'default') return;
  await requestPermission();
}

// Browser notifications actually work only when the setting is enabled AND
// system permission is granted. The UI toggle reflects exactly that (it doesn't
// claim "enabled" when popups wouldn't actually appear).
export function browserNotificationsActive(): boolean {
  return getNotifPrefs().browser && getPermission() === 'granted';
}

// Base tab title captured at module load — the counter is prepended to it.
// Changed only when there are unread messages, otherwise restored as before.
const baseTitle = typeof document !== 'undefined' ? document.title : 'alpha';

export function setUnreadBadge(count: number): void {
  if (typeof document === 'undefined') return;
  document.title = count > 0 ? `(${count}) ${baseTitle}` : baseTitle;
}

// Short "pop" via WebAudio — no asset, no network request. AudioContext is
// created lazily and reused; we don't rely on autoplay policy — if the context
// didn't start (no user gesture), just stay silent.
let audioCtx: AudioContext | null = null;

function ensureAudioCtx(): AudioContext | null {
  try {
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!Ctor) return null;
    if (!audioCtx) audioCtx = new Ctor();
    return audioCtx;
  } catch {
    return null;
  }
}

export function playSound(): void {
  const ctx = ensureAudioCtx();
  if (!ctx) return;
  try {
    if (ctx.state === 'suspended') void ctx.resume();
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    // Two short notes going up — a recognizable unobtrusive signal.
    osc.frequency.setValueAtTime(660, now);
    osc.frequency.setValueAtTime(880, now + 0.09);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.18, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.25);
    osc.connect(gain).connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.26);
  } catch {
    /* playback unavailable — not critical */
  }
}

function showBrowserNotification(
  title: string,
  body: string,
  onOpen: () => void,
): void {
  // In Electron, use native notifications via IPC
  if (window.electronAPI) {
    window.electronAPI.showNotification(title, body);
    return;
  }
  // In Capacitor (Android) — native notifications via plugin
  const cap = (window as any).Capacitor;
  if (cap?.isNativePlatform?.() && cap?.Plugins?.AlphaNotification) {
    cap.Plugins.AlphaNotification.showNotification({ title, body });
    return;
  }
  // In the browser — Web Notifications
  try {
    const n = new Notification(title, { body, tag: 'alpha-message' });
    n.onclick = () => {
      window.focus();
      onOpen();
      n.close();
    };
  } catch {
    /* constructor may throw on some platforms — ignore */
  }
}

// Is the tab active right now (visible and focused). hasFocus rules out the
// case "tab visible but another window is on top".
function inForeground(): boolean {
  return (
    typeof document !== 'undefined' &&
    !document.hidden &&
    (typeof document.hasFocus !== 'function' || document.hasFocus())
  );
}

// Reaction to an incoming message (sound + browser notification). Call only for
// others' live messages — senderId/isLive filtering is done by the caller.
let electronClickRegistered = false;

export function notifyIncoming(opts: {
  title: string;
  ciphertext: string;
  chatId: string;
  currentChatId: string | null;
  isReply?: boolean;
  onOpen: () => void;
}): void {
  // Like Telegram: foreground and same chat open — no notification.
  // Different chat or background — notification + sound.
  const sameOpenChat = inForeground() && opts.currentChatId === opts.chatId;
  if (sameOpenChat) return;
  const prefs = getNotifPrefs();
  const isElectron = !!window.electronAPI;
  const isNative = isElectron || !!(window as any).Capacitor?.isNativePlatform?.();
  // On Capacitor the native notification plays the sound (notification_sound.wav)
  if (prefs.sound && !isNative) playSound();
  // In Electron and Capacitor, native notifications don't require browser permission
  if (prefs.browser && (isNative || getPermission() === 'granted')) {
    const body = opts.isReply
      ? i18n.t('notif.repliedTo', {
          text: previewText(decodeContent(opts.ciphertext)),
        })
      : previewText(decodeContent(opts.ciphertext));
    // In Electron, register the click handler once
    if (isElectron && !electronClickRegistered) {
      electronClickRegistered = true;
      window.electronAPI!.onNotificationClick(() => {
        window.electronAPI?.focus();
      });
    }
    showBrowserNotification(opts.title, body, opts.onOpen);
  }
}

// Reaction to a user's message (sound + browser notification).
// Call only for others' reactions — own reactions are filtered out by the caller.
export function notifyReaction(opts: {
  title: string;
  reactor: string;
  emoji: string;
  onOpen: () => void;
}): void {
  if (inForeground()) return;
  const prefs = getNotifPrefs();
  const isElectron = !!window.electronAPI;
  const isNativeCap = !!(window as any).Capacitor?.isNativePlatform?.();
  if (prefs.sound && !isNativeCap) playSound();
  const isNative = isElectron || isNativeCap;
  if (prefs.browser && (isNative || getPermission() === 'granted')) {
    const body = i18n.t('notif.reacted', { name: opts.reactor, emoji: opts.emoji });
    if (isElectron && !electronClickRegistered) {
      electronClickRegistered = true;
      window.electronAPI!.onNotificationClick(() => {
        window.electronAPI?.focus();
      });
    }
    showBrowserNotification(opts.title, body, opts.onOpen);
  }
}
