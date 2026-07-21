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

function getServerUrl(): string | null {
  if ((window as any).AlphaConfig?.getServerUrl()) return (window as any).AlphaConfig.getServerUrl();
  if ((window as any).__ALPHA_CONFIG__?.serverUrl) return (window as any).__ALPHA_CONFIG__.serverUrl;
  return localStorage.getItem('alpha.serverUrl');
}

export function App(): JSX.Element {
  const [authed, setAuthed] = useState(() => !!getToken());
  const [start] = useState(initialView);
  const [view, setView] = useState<View>(start.view);
  const [ready, setReady] = useState(() => getPlatform() !== 'android' || !!getServerUrl());

  useEffect(() => {
    initPlatform();
  }, []);

  // Android: нативный SetupActivity handles URL.
  // Если URL ещё не доступен в web-контексте (evaluateJavascript ещё не выполнился) —
  // ждём доступности, poll с интервалом.
  useEffect(() => {
    if (getPlatform() !== 'android' || ready) return;
    const id = setInterval(() => {
      if (getServerUrl()) {
        setReady(true);
      }
    }, 50);
    return () => clearInterval(id);
  }, [ready]);

  if (!ready) {
    return (
      <div className="auth-screen">
        <div className="auth-card" style={{ textAlign: 'center', padding: 32 }}>
          <p style={{ color: '#aaa' }}>Загрузка...</p>
        </div>
      </div>
    );
  }

  // Web/desktop: показываем SetupScreen если URL не настроен
  if (!getServerUrl()) {
    return (
      <SetupScreen
        onConfigured={(url: string) => {
          localStorage.setItem('alpha.serverUrl', url);
          (window as any).__ALPHA_CONFIG__ = { serverUrl: url };
          setReady(true);
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
