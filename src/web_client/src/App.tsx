import { useState, useEffect } from 'react';
import { clearSession, getToken } from './api/session';
import { LoginScreen } from './auth/LoginScreen';
import { RegisterScreen } from './auth/RegisterScreen';
import { SetupScreen } from './auth/SetupScreen';
import { HomeScreen } from './HomeScreen';
import { PushWarningBanner } from './notifications/PushWarningBanner';
import { initPlatform } from './util/platform';

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
  const ls = localStorage.getItem('alpha.serverUrl');
  if (ls) return ls;
  // Если грузим с сервера напрямую — URL уже в window.location.origin
  const origin = window.location.origin;
  if (origin && origin !== 'null' && !origin.startsWith('file:')) return origin;
  return null;
}

export function App(): JSX.Element {
  const [authed, setAuthed] = useState(() => !!getToken());
  const [start] = useState(initialView);
  const [view, setView] = useState<View>(start.view);

  useEffect(() => {
    initPlatform();
  }, []);

  // Web/desktop: показываем SetupScreen если URL не настроен
  if (!getServerUrl()) {
    return (
      <SetupScreen
        onConfigured={(url: string) => {
          localStorage.setItem('alpha.serverUrl', url);
          (window as any).__ALPHA_CONFIG__ = { serverUrl: url };
          window.location.reload();
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
