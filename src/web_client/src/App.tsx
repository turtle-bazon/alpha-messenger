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

  useEffect(() => {
    initPlatform();
  }, []);

  // Android: нативный SetupActivity handles URL.
  // Java скачивает клиент и пишет settings.js в ту же папку.
  // <script src="settings.js"> загружается ДО React → __ALPHA_CONFIG__ доступен.
  // Если settings.js нет (bundled fallback, сервер недоступен) — показываем ошибку.
  if (getPlatform() === 'android' && !getServerUrl()) {
    return (
      <div className="auth-screen">
        <div className="auth-card" style={{ textAlign: 'center', padding: 32 }}>
          <h1>Ошибка</h1>
          <p style={{ color: '#aaa', marginTop: 12 }}>
            Не удалось подключиться к серверу.<br />
            Проверьте адрес и попробуйте снова.
          </p>
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
