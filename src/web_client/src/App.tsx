import { useState, useEffect } from 'react';
import { clearSession, getToken } from './api/session';
import { LoginScreen } from './auth/LoginScreen';
import { RegisterScreen } from './auth/RegisterScreen';
import { SetupScreen } from './auth/SetupScreen';
import { HomeScreen } from './HomeScreen';
import { PushWarningBanner } from './notifications/PushWarningBanner';
import { initPlatform, getPlatform } from './util/platform';

type View = 'login' | 'register';

// Простейшая маршрутизация по location: /register?invite=CODE открывает
// регистрацию, иначе — вход. Полноценный роутер v1 не нужен.
function initialView(): { view: View; invite: string } {
  const url = new URL(window.location.href);
  if (url.pathname === '/register') {
    return { view: 'register', invite: url.searchParams.get('invite') ?? '' };
  }
  return { view: 'login', invite: '' };
}

export function App(): JSX.Element {
  const [authed, setAuthed] = useState(() => !!getToken());
  const [start] = useState(initialView);
  const [view, setView] = useState<View>(start.view);

  // На Android: нужна настройка сервера если нет сохранённого URL
  const [needsSetup, setNeedsSetup] = useState(() => {
    if (getPlatform() !== 'android') return false;
    return !localStorage.getItem('alpha.serverUrl');
  });

  // Инициализация платформы (push, нативные плагины)
  useEffect(() => {
    initPlatform();
  }, []);

  // Setup screen — только на Android
  if (needsSetup) {
    return (
      <SetupScreen onConfigured={() => {
        const url = localStorage.getItem('alpha.serverUrl');
        if (url) {
          // Загружаем web-клиент с сервера (всегда актуальная версия,
          // как в desktop-приложении). Фолбэк на bundled не нужен —
          // сервер отдаёт тот же SPA.
          window.location.href = url;
        } else {
          setNeedsSetup(false);
          window.location.reload();
        }
      }} />
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
