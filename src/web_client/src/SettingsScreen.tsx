import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Theme } from './util/theme';
import { getPlatform } from './util/platform';
import { IconArrowLeft, IconBell, IconMoon, IconSun, IconInfo, IconChevronRight, IconMonitor, IconGlobe } from './util/icons';
import {
  getNotifPrefs,
  getPermission,
  notificationsSupported,
  requestPermission,
  setNotifBrowser,
  setNotifSound,
  type NotifPrefs,
} from './util/notifications';
import { DevicesScreen } from './DevicesScreen';
import { LANGS, switchLanguage, type Lang } from './i18n';

type SettingsView = 'main' | 'notifications' | 'devices';

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
  const { t, i18n } = useTranslation();
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
    // On Android push goes through native UnifiedPush/FCM; browser permission not needed
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
            aria-label={t('common.back')}
            onClick={() => setView('main')}
          >
            <IconArrowLeft />
          </button>
          <span className="settings-header-title">{t('settings.notifications')}</span>
        </header>
        <div className="settings-items">
          <label className="settings-row">
            <span className="settings-row-text">{t('settings.sound')}</span>
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
                <span className="settings-row-text">{t('settings.push')}</span>
                <input
                  type="checkbox"
                  className="settings-toggle"
                  data-testid="settings-browser"
                  checked={prefs.browser}
                  onChange={() => void toggleBrowser()}
                />
              </label>
              <div className="settings-hint">{t('settings.pushHint')}</div>
            </>
          ) : (
            <>
              <label className="settings-row">
                <span className="settings-row-text">{t('settings.browserNotifs')}</span>
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
                  {t('settings.denied')}
                </div>
              )}
              {!notificationsSupported() && (
                <div className="settings-hint">
                  {t('settings.notSupported')}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    );
  }

  if (view === 'devices') {
    return <DevicesScreen onBack={() => setView('main')} />;
  }

  // Main settings screen
  return (
    <div className="settings-screen" data-testid="settings-screen">
      <header className="settings-header">
        <button
          type="button"
          className="icon-button settings-back"
          data-testid="settings-back"
          aria-label={t('common.back')}
          onClick={onBack}
          >
            <IconArrowLeft />
          </button>
          <span className="settings-header-title">{t('settings.title')}</span>
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
          <span className="settings-row-text">{t('settings.notifications')}</span>
          <span className="settings-row-value">
            {prefs.sound || prefs.browser ? t('common.on') : t('common.off')}
          </span>
          <span className="settings-row-arrow"><IconChevronRight /></span>
        </button>
        <button
          type="button"
          className="settings-row settings-row--button"
          data-testid="settings-devices"
          onClick={() => setView('devices')}
        >
          <span className="settings-row-icon"><IconMonitor /></span>
          <span className="settings-row-text">{t('settings.devices')}</span>
          <span className="settings-row-arrow"><IconChevronRight /></span>
        </button>
        <label className="settings-row">
          <span className="settings-row-icon"><IconGlobe /></span>
          <span className="settings-row-text">{t('settings.language')}</span>
          <select
            className="settings-lang"
            data-testid="settings-language"
            value={i18n.language}
            onChange={(e) => void switchLanguage(e.target.value as Lang)}
          >
            {LANGS.map((l) => (
              <option key={l.code} value={l.code}>
                {l.name}
              </option>
            ))}
          </select>
        </label>
        <label className="settings-row">
          <span className="settings-row-icon">
            {theme === 'dark' ? <IconMoon /> : <IconSun />}
          </span>
          <span className="settings-row-text">{t('settings.darkTheme')}</span>
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
          <span className="settings-row-text">{t('settings.about')}</span>
          <span className="settings-row-arrow"><IconChevronRight /></span>
        </button>
      </div>
      <div className="settings-debug" data-testid="settings-debug">
        <div className="settings-debug-title">{t('settings.sysinfo')}</div>
        <div>{t('settings.platform')}: <b>{getPlatform()}</b></div>
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
          {t('settings.logout')}
        </button>
      </div>
    </div>
  );
}
