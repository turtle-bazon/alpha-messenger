import { useState, useEffect } from 'react';
import { clearSession, getToken } from './api/session';
import { LoginScreen } from './auth/LoginScreen';
import { RegisterScreen } from './auth/RegisterScreen';
import { SetupScreen } from './auth/SetupScreen';
import { HomeScreen } from './HomeScreen';
import { PushWarningBanner } from './notifications/PushWarningBanner';
import { initPlatform, getPlatform } from './util/platform';

type View = 'login' | 'register';

function initialView(): { view: View; invite: string } {
  const url = new URL(window.location.href);
  if (url.pathname === '/register') {
    return { view: 'register', invite: url.searchParams.get('invite') ?? '' };
  }
  return { view: 'login', invite: '' };
}

function hasServerUrl(): boolean {
  if ((window as any).AlphaConfig?.getServerUrl()) return true;
  if ((window as any).__ALPHA_CONFIG__?.serverUrl) return true;
  if (localStorage.getItem('alpha.serverUrl')) return true;
  return false;
}

export function App(): JSX.Element {
  const [authed, setAuthed] = useState(() => !!getToken());
  const [start] = useState(initialView);
  const [view, setView] = useState<View>(start.view);

  // На Android: нативный SetupActivity показывает экран настройки.
  // Если URL не задан — нужен web-setup (fallback).
  // hasServerUrl() проверяет: AlphaConfig (addJavascriptInterface) →
  // __ALPHA_CONFIG__ (settings.js) → localStorage.
  const [needsSetup, setNeedsSetup] = useState(() => {
    if (getPlatform() !== 'android') return false;
    return !hasServerUrl();
  });

  useEffect(() => {
    initPlatform();
  }, []);

  if (needsSetup) {
    return (
      <SetupScreen
        onConfigured={(url: string) => {
          localStorage.setItem('alpha.serverUrl', url);
          // Устанавливаем __ALPHA_CONFIG__ чтобы getApiUrl() и hasServerUrl()
          // работали сразу, без reload. WebView остаётся тот же.
          (window as any).__ALPHA_CONFIG__ = { serverUrl: url };
          setNeedsSetup(false);
        }}
      />
    );
  }

  if (authed) {
    return (
      <div className="app-shell" data-testid="app-shell">
        <PushWarningBanner />
        <HomeScreen
          onLogout={() => {
            clearSession();
            setAuthed(false);
            setView('login');
          }}
        />
      </div>
    );
  }

  return (
    <div className="app-shell" data-testid="app-shell">
      {view === 'register' ? (
        <RegisterScreen
          invite={start.invite}
          onAuthed={() => setAuthed(true)}
          onGoLogin={() => setView('login')}
        />
      ) : (
        <LoginScreen onAuthed={() => setAuthed(true)} />
      )}
    </div>
  );
}
