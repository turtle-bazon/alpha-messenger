import { useState } from 'react';
import type { Theme } from './util/theme';
import { getPlatform } from './util/platform';
import { IconArrowLeft, IconBell, IconMoon, IconSun, IconInfo, IconChevronRight } from './util/icons';
import {
  getNotifPrefs,
  getPermission,
  notificationsSupported,
  requestPermission,
  setNotifBrowser,
  setNotifSound,
  type NotifPrefs,
} from './util/notifications';

type SettingsView = 'main' | 'notifications';

interface SettingsScreenProps {
  username: string | null;
  theme: Theme;
  onToggleTheme: () => void;
  onLogout: () => void;
  onAbout: () => void;
  onBack: () => void;
}

export function SettingsScreen({
  username,
  theme,
  onToggleTheme,
  onLogout,
  onAbout,
  onBack,
}: SettingsScreenProps): JSX.Element {
  const [view, setView] = useState<SettingsView>('main');
  const [prefs, setPrefs] = useState(getNotifPrefs);
  const [perm, setPerm] = useState<NotificationPermission>(getPermission());

  function toggleSound(): void {
    const next = !prefs.sound;
    setNotifSound(next);
    setPrefs((p: NotifPrefs) => ({ ...p, sound: next }));
  }

  async function toggleBrowser(): Promise<void> {
    if (prefs.browser) {
      setNotifBrowser(false);
      setPrefs((p: NotifPrefs) => ({ ...p, browser: false }));
      return;
    }
    // На Android push идут через нативный UnifiedPush/FCM, разрешение браузера не нужно
    if (isAndroid) {
      setNotifBrowser(true);
      setPrefs((p: NotifPrefs) => ({ ...p, browser: true }));
      return;
    }
    let permission = perm;
    if (permission !== 'granted') {
      permission = await requestPermission();
      setPerm(permission);
    }
    if (permission === 'granted') {
      setNotifBrowser(true);
      setPrefs((p: NotifPrefs) => ({ ...p, browser: true }));
    }
  }

  const isAndroid = getPlatform() === 'android';

  if (view === 'notifications') {
    return (
      <div className="settings-screen" data-testid="settings-screen">
        <header className="settings-header">
          <button
            type="button"
            className="icon-button settings-back"
            data-testid="settings-back"
            aria-label="Назад"
            onClick={() => setView('main')}
          >
            <IconArrowLeft />
          </button>
          <span className="settings-header-title">Уведомления</span>
        </header>
        <div className="settings-items">
          <label className="settings-row">
            <span className="settings-row-text">Звук</span>
            <input
              type="checkbox"
              className="settings-toggle"
              data-testid="settings-sound"
              checked={prefs.sound}
              onChange={toggleSound}
            />
          </label>
          {isAndroid ? (
            <>
              <label className="settings-row">
                <span className="settings-row-text">Push-уведомления</span>
                <input
                  type="checkbox"
                  className="settings-toggle"
                  data-testid="settings-browser"
                  checked={prefs.browser}
                  onChange={() => void toggleBrowser()}
                />
              </label>
              <div className="settings-hint">
                Через UnifiedPush / FCM
              </div>
            </>
          ) : (
            <>
              <label className="settings-row">
                <span className="settings-row-text">Уведомления браузера</span>
                <input
                  type="checkbox"
                  className="settings-toggle"
                  data-testid="settings-browser"
                  checked={prefs.browser && perm === 'granted' ? true : prefs.browser}
                  disabled={!notificationsSupported() || perm === 'denied'}
                  onChange={() => void toggleBrowser()}
                />
              </label>
              {perm === 'denied' && (
                <div className="settings-hint" data-testid="settings-denied">
                  Уведомления заблокированы в настройках браузера
                </div>
              )}
              {!notificationsSupported() && (
                <div className="settings-hint">
                  Браузер не поддерживает уведомления
                </div>
              )}
            </>
          )}
        </div>
      </div>
    );
  }

  // Main settings view
  return (
    <div className="settings-screen" data-testid="settings-screen">
      <header className="settings-header">
        <button
          type="button"
          className="icon-button settings-back"
          data-testid="settings-back"
          aria-label="Назад"
          onClick={onBack}
          >
            <IconArrowLeft />
          </button>
          <span className="settings-header-title">Настройки</span>
      </header>
      <div className="settings-user">
        <span className="settings-avatar">
          {username ? username[0].toUpperCase() : '?'}
        </span>
        <span className="settings-username">{username ?? '...'}</span>
      </div>
      <div className="settings-items">
        <button
          type="button"
          className="settings-row settings-row--button"
          data-testid="settings-notifications"
          onClick={() => setView('notifications')}
        >
          <span className="settings-row-icon"><IconBell /></span>
          <span className="settings-row-text">Уведомления</span>
          <span className="settings-row-value">
            {prefs.sound || prefs.browser ? 'Вкл' : 'Выкл'}
          </span>
          <span className="settings-row-arrow"><IconChevronRight /></span>
        </button>
        <label className="settings-row">
          <span className="settings-row-icon">
            {theme === 'dark' ? <IconMoon /> : <IconSun />}
          </span>
          <span className="settings-row-text">Тёмная тема</span>
          <input
            type="checkbox"
            className="settings-toggle"
            data-testid="settings-theme"
            checked={theme === 'dark'}
            onChange={onToggleTheme}
          />
        </label>
        <button
          type="button"
          className="settings-row settings-row--button"
          data-testid="settings-about"
          onClick={onAbout}
        >
          <span className="settings-row-icon"><IconInfo /></span>
          <span className="settings-row-text">О приложении</span>
          <span className="settings-row-arrow"><IconChevronRight /></span>
        </button>
      </div>
      <div className="settings-debug" data-testid="settings-debug">
        <div className="settings-debug-title">Системная информация</div>
        <div>Платформа: <b>{getPlatform()}</b></div>
        <div>Capacitor: <b>{String(!!(window as any).Capacitor)}</b></div>
        <div>isNativePlatform: <b>{String((window as any).Capacitor?.isNativePlatform?.() ?? 'N/A')}</b></div>
        <div>userAgent: <b style={{ wordBreak: 'break-all' }}>{navigator.userAgent}</b></div>
      </div>
      <div className="settings-footer">
        <button
          type="button"
          className="settings-logout"
          data-testid="settings-logout"
          onClick={onLogout}
        >
          Выйти
        </button>
      </div>
    </div>
  );
}
