import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { IconBell, IconBellOff } from '../util/icons';
import {
  getNotifPrefs,
  getPermission,
  notificationsSupported,
  requestPermission,
  setNotifBrowser,
  setNotifSound,
} from '../util/notifications';

// Bell button in the header + dropdown menu with notification settings
// (known issue #8): sound and browser notification toggles. Enabling browser
// notifications requests system permission; on denial the toggle stays off
// and we show a hint.
export function NotificationSettings(): JSX.Element {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [prefs, setPrefs] = useState(getNotifPrefs);
  const [perm, setPerm] = useState<NotificationPermission>(getPermission());
  const rootRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  // Menu coordinates (position: fixed). null — not positioned yet (hidden).
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  // Menu positioning (known issue #11). The bell is not the rightmost header
  // button, so a fixed-width menu aligned to its right edge used to stick out
  // past the left edge of .app-shell (overflow: hidden) and get clipped.
  // Telegram-like solution: the menu is position: fixed (escapes the overflow
  // container), aligned to the button's right edge and clamped within the
  // viewport so it isn't clipped on either side.
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

  // Close on outside click and Escape.
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

  // Browser popups actually work only when both the setting and the system
  // permission are on — needed for the bell icon (anyOn).
  const browserActive = prefs.browser && perm === 'granted';
  // What the toggle shows. When granted — the real state (browserActive).
  // When default — user intent (prefs.browser): permission not yet requested
  // but the setting may already be on (default '1'). When denied — also
  // prefs.browser (on but blocked, toggle disabled, like Telegram).
  const browserChecked = perm === 'granted' ? browserActive : prefs.browser;

  async function toggleBrowser(): Promise<void> {
    // Turning off just clears the setting. Turning on requires system
    // permission: if not yet granted — request it and enable only when granted.
    // (When denied the input is disabled — we never get here.)
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
    // Re-read permission and prefs on open — they may have changed outside this
    // component: system permission (changed in browser settings), and
    // prefs.browser via the request modal at login (handleNotifAllow/Skip write
    // to localStorage but not this state). Otherwise the toggle would show a
    // stale value.
    if (!open) {
      setPerm(getPermission());
      setPrefs(getNotifPrefs());
    }
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
        aria-label={t("settings.notifications")}
        title={t("settings.notifications")}
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
            <span>{t("settings.sound")}</span>
            <input
              type="checkbox"
              data-testid="notif-sound"
              checked={prefs.sound}
              onChange={toggleSound}
            />
          </label>
          <label className="notif-row">
            <span>{t("settings.browserNotifs")}</span>
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
              {t('settings.denied')}
            </div>
          )}
          {!notificationsSupported() && (
            <div className="notif-hint">
              {t('settings.notSupported')}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
