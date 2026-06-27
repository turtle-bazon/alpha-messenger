import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { IconBell, IconBellOff } from '../util/icons';
import {
  getNotifPrefs,
  getPermission,
  notificationsSupported,
  requestPermission,
  setNotifBrowser,
  setNotifSound,
} from '../util/notifications';

// Кнопка-колокольчик в шапке + выпадающее меню с настройками уведомлений
// (известная проблема №8): тумблеры звука и браузерных уведомлений. Включение
// браузерных запрашивает системное разрешение; при отказе тумблер остаётся
// выключенным, показываем подсказку.
export function NotificationSettings(): JSX.Element {
  const [open, setOpen] = useState(false);
  const [prefs, setPrefs] = useState(getNotifPrefs);
  const [perm, setPerm] = useState<NotificationPermission>(getPermission());
  const rootRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  // Координаты меню (position: fixed). null — ещё не позиционировано (скрыто).
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  // Позиционирование меню (известная проблема №11). Колокольчик — не самая
  // правая кнопка шапки, поэтому меню фиксированной ширины, выровненное по его
  // правому краю, вылезало за левую границу .app-shell (overflow: hidden) и
  // обрезалось. Решение как в Telegram: меню — position: fixed (вырывается из
  // overflow-контейнера), выравниваем по правому краю кнопки и поджимаем
  // (clamp) в пределах вьюпорта, чтобы не обрезалось ни слева, ни справа.
  useLayoutEffect(() => {
    if (!open || !rootRef.current || !menuRef.current) {
      setPos(null);
      return;
    }
    const btn = rootRef.current
      .querySelector('button')!
      .getBoundingClientRect();
    const mw = menuRef.current.offsetWidth;
    const gap = 8;
    const left = Math.max(
      gap,
      Math.min(window.innerWidth - mw - gap, btn.right - mw),
    );
    setPos({ top: btn.bottom + 6, left });
  }, [open]);

  // Закрытие по клику вне меню и по Escape.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent): void => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  function toggleSound(): void {
    const next = !prefs.sound;
    setNotifSound(next);
    setPrefs((p) => ({ ...p, sound: next }));
  }

  // Браузерные попапы реально работают, только когда и настройка, и системное
  // разрешение «за» — это нужно для иконки колокольчика (anyOn).
  const browserActive = prefs.browser && perm === 'granted';
  // Что показывает тумблер. В норме — реальное состояние (browserActive): пока
  // разрешение не выдано (default), честно «выключено». Исключение — denied
  // (#30): разрешение заблокировано/недоступно, тумблер недоступен, поэтому
  // показываем сохранённую настройку (по умолчанию включена) — «включён, но
  // заблокирован», как в Telegram, без рассинхрона с localStorage.
  const browserChecked = perm === 'denied' ? prefs.browser : browserActive;

  async function toggleBrowser(): Promise<void> {
    // Выключение — просто гасим настройку. Включение требует системного
    // разрешения: если ещё не дано — запрашиваем и включаем только при granted.
    // (При denied input disabled — сюда не попадаем.)
    if (browserActive) {
      setNotifBrowser(false);
      setPrefs((p) => ({ ...p, browser: false }));
      return;
    }
    let permission = perm;
    if (permission !== 'granted') {
      permission = await requestPermission();
      setPerm(permission);
    }
    if (permission === 'granted') {
      setNotifBrowser(true);
      setPrefs((p) => ({ ...p, browser: true }));
    }
  }

  function openMenu(): void {
    // Перечитываем разрешение при открытии — оно могло измениться (автозапрос
    // при входе, смена в настройках браузера).
    if (!open) setPerm(getPermission());
    setOpen((v) => !v);
  }

  const anyOn = prefs.sound || browserActive;
  const denied = perm === 'denied';

  return (
    <div className="notif-settings" ref={rootRef}>
      <button
        type="button"
        className="icon-button"
        data-testid="notif-toggle"
        aria-label="Уведомления"
        title="Уведомления"
        aria-expanded={open}
        onClick={openMenu}
      >
        {anyOn ? <IconBell /> : <IconBellOff />}
      </button>
      {open && (
        <div
          className="notif-menu"
          data-testid="notif-menu"
          role="menu"
          ref={menuRef}
          style={
            pos
              ? { top: pos.top, left: pos.left }
              : { visibility: 'hidden' }
          }
        >
          <label className="notif-row">
            <span>Звук</span>
            <input
              type="checkbox"
              data-testid="notif-sound"
              checked={prefs.sound}
              onChange={toggleSound}
            />
          </label>
          <label className="notif-row">
            <span>Уведомления браузера</span>
            <input
              type="checkbox"
              data-testid="notif-browser"
              checked={browserChecked}
              disabled={!notificationsSupported() || denied}
              onChange={() => void toggleBrowser()}
            />
          </label>
          {denied && (
            <div className="notif-hint" data-testid="notif-denied">
              Уведомления заблокированы в настройках браузера
            </div>
          )}
          {!notificationsSupported() && (
            <div className="notif-hint">
              Браузер не поддерживает уведомления
            </div>
          )}
        </div>
      )}
    </div>
  );
}
