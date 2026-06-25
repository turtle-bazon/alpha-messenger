import { useEffect, useRef, useState } from 'react';
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

  async function toggleBrowser(): Promise<void> {
    // Выключение — без вопросов. Включение требует системного разрешения:
    // если ещё не дано — запрашиваем и включаем только при granted.
    if (prefs.browser) {
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

  const anyOn = prefs.sound || prefs.browser;
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
        onClick={() => setOpen((v) => !v)}
      >
        {anyOn ? <IconBell /> : <IconBellOff />}
      </button>
      {open && (
        <div className="notif-menu" data-testid="notif-menu" role="menu">
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
              checked={prefs.browser}
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
