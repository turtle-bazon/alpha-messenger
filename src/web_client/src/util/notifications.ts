// Уведомления о новых сообщениях (известная проблема №8). Три механизма:
//  (а) browser notification — системное уведомление, если разрешено;
//  (б) счётчик непрочитанных в title вкладки — «(3) alpha»;
//  (в) короткий звук при новом сообщении, когда вкладка не активна.
// Настройки (звук / браузерные уведомления) хранятся в localStorage, по
// умолчанию всё включено. Звук и попап срабатывают только когда пользователь не
// смотрит на вкладку (как в Telegram Web) — при активной вкладке хватает badge в
// title и счётчика в списке чатов; уведомления о собственных и реплейных
// событиях отсекаются вызывающей стороной.

import { decodeContent, previewText } from './content';

export interface NotifPrefs {
  sound: boolean;
  browser: boolean;
}

const SOUND_KEY = 'alpha.notif.sound';
const BROWSER_KEY = 'alpha.notif.browser';

// Дефолт — включено: выключение хранится явным '0', отсутствие ключа = вкл.
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

// Явная инициализация дефолтов при входе (известные проблемы №29 и №30). Раньше
// отсутствие ключа неявно означало «включено», из-за чего после очистки
// localStorage ключей не было вовсе. Теперь дефолты сидятся явно — оба '1'.
//
// Важно (проблема №30): дефолт browser ВСЕГДА '1', независимо от текущего
// Notification.permission. Прежняя завязка на denied была ошибочной: getPermission()
// отдаёт 'denied' не только когда пользователь реально заблокировал уведомления,
// но и когда Notification API недоступен (старый браузер, http без secure-context).
// В таком окружении дефолт ошибочно становился '0'. Теперь при denied настройка
// остаётся включённой ('1'), а в UI тумблер показывается включённым, но
// заблокированным (как в Telegram); ensureBrowserPermission() при denied просто
// ничего не делает (не спрашивает). Идемпотентно: явный выбор не перетираем.
export function initNotifDefaults(): void {
  if (localStorage.getItem(SOUND_KEY) === null) setNotifSound(true);
  if (localStorage.getItem(BROWSER_KEY) === null) setNotifBrowser(true);
}

// Пользователь уже делал выбор настроек уведомлений (хотя бы один раз открывал
// меню или нажимал кнопку в баннере). Если ключа нет — это первый вход.
export function hasNotifPref(): boolean {
  return localStorage.getItem(BROWSER_KEY) !== null;
}

// Поддержка Notification API может отсутствовать (старый браузер, http без
// secure-context) — тогда считаем разрешение недоступным.
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

// Проактивный запрос разрешения при входе. Браузерные попапы по спецификации
// показываются только при granted, а у нового пользователя permission='default'.
// Раз настройка браузерных уведомлений включена (дефолт), сразу спрашиваем
// системное разрешение — чтобы попапы заработали «из коробки», без захода в
// настройки. Если разрешение уже дано/запрещено — ничего не делаем.
export async function ensureBrowserPermission(): Promise<void> {
  if (!notificationsSupported()) return;
  if (!getNotifPrefs().browser) return;
  if (Notification.permission !== 'default') return;
  await requestPermission();
}

// Браузерные уведомления реально работают, только когда настройка включена И
// системное разрешение выдано. Тумблер в UI отражает именно это (не врёт, что
// «включено», когда попапы на деле не покажутся).
export function browserNotificationsActive(): boolean {
  return getNotifPrefs().browser && getPermission() === 'granted';
}

// Базовый title вкладки фиксируем при загрузке модуля — к нему приписываем
// счётчик. Меняем только когда есть непрочитанные, иначе возвращаем как было.
const baseTitle = typeof document !== 'undefined' ? document.title : 'alpha';

export function setUnreadBadge(count: number): void {
  if (typeof document === 'undefined') return;
  document.title = count > 0 ? `(${count}) ${baseTitle}` : baseTitle;
}

// Короткий «поп» через WebAudio — без ассета и сетевого запроса. AudioContext
// создаётся лениво и переиспользуется; на автоплей-политику не полагаемся —
// если контекст не запустился (нет пользовательского жеста), просто молчим.
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
    // Две короткие ноты вверх — узнаваемый ненавязчивый сигнал.
    osc.frequency.setValueAtTime(660, now);
    osc.frequency.setValueAtTime(880, now + 0.09);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.18, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.25);
    osc.connect(gain).connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.26);
  } catch {
    /* воспроизведение недоступно — не критично */
  }
}

function showBrowserNotification(
  title: string,
  body: string,
  onOpen: () => void,
): void {
  // В Electron используем нативные уведомления через IPC
  if (window.electronAPI) {
    window.electronAPI.showNotification(title, body);
    return;
  }
  // В Capacitor (Android) — нативные уведомления через плагин
  const cap = (window as any).Capacitor;
  if (cap?.isNativePlatform?.() && cap?.Plugins?.AlphaNotification) {
    cap.Plugins.AlphaNotification.showNotification({ title, body });
    return;
  }
  // В браузере — Web Notifications
  try {
    const n = new Notification(title, { body, tag: 'alpha-message' });
    n.onclick = () => {
      window.focus();
      onOpen();
      n.close();
    };
  } catch {
    /* конструктор может бросить на части платформ — игнорируем */
  }
}

// Активна ли вкладка прямо сейчас (видима и в фокусе). hasFocus отсекает случай
// «вкладка видна, но поверх неё другое окно».
function inForeground(): boolean {
  return (
    typeof document !== 'undefined' &&
    !document.hidden &&
    (typeof document.hasFocus !== 'function' || document.hasFocus())
  );
}

// Реакция на входящее сообщение (звук + браузерное уведомление). Вызывать только
// для чужих живых сообщений — фильтрацию по senderId/isLive делает вызывающий.
let electronClickRegistered = false;

export function notifyIncoming(opts: {
  title: string;
  ciphertext: string;
  isReply?: boolean;
  onOpen: () => void;
}): void {
  // Пользователь смотрит на приложение — лишний шум не нужен (badge и список
  // и так обновятся). Сигналим только когда вкладка не активна.
  if (inForeground()) return;
  const prefs = getNotifPrefs();
  if (prefs.sound) playSound();
  // В Electron нативные уведомления не требуют разрешения браузера
  const isElectron = !!window.electronAPI;
  if (prefs.browser && (isElectron || getPermission() === 'granted')) {
    const body = opts.isReply
      ? `Ответил(а) на ваше сообщение: ${previewText(decodeContent(opts.ciphertext))}`
      : previewText(decodeContent(opts.ciphertext));
    // В Electron регистрируем обработчик клика один раз
    if (isElectron && !electronClickRegistered) {
      electronClickRegistered = true;
      window.electronAPI!.onNotificationClick(() => {
        window.electronAPI?.focus();
      });
    }
    showBrowserNotification(opts.title, body, opts.onOpen);
  }
}

// Реакция на сообщение пользователя (звук + браузерное уведомление).
// Вызывать только для чужих реакций — свою реакцию вызывающая сторона отсекает.
export function notifyReaction(opts: {
  title: string;
  reactor: string;
  emoji: string;
  onOpen: () => void;
}): void {
  if (inForeground()) return;
  const prefs = getNotifPrefs();
  if (prefs.sound) playSound();
  const isElectron = !!window.electronAPI;
  if (prefs.browser && (isElectron || getPermission() === 'granted')) {
    const body = `${opts.reactor} поставил(а) ${opts.emoji}`;
    if (isElectron && !electronClickRegistered) {
      electronClickRegistered = true;
      window.electronAPI!.onNotificationClick(() => {
        window.electronAPI?.focus();
      });
    }
    showBrowserNotification(opts.title, body, opts.onOpen);
  }
}
