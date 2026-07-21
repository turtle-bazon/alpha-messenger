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

  // На Android: нативный SetupActivity показывает экран настройки
  // и сохраняет URL в SharedPreferences. Java записывает settings.js
  // в кеш-директорию с window.__ALPHA_CONFIG__. Если settings.js
  // не загрузился — значит URL не настроен, нужен web-setup.
  const [needsSetup] = useState(() => {
    if (getPlatform() !== 'android') return false;
    return !(window as any).__ALPHA_CONFIG__?.serverUrl;
  });

  // Инициализация платформы (push, нативные плагины)
  useEffect(() => {
    initPlatform();
  }, []);

  // Setup screen — только если settings.js не загрузился (URL не настроен в Java)
  if (needsSetup) {
    return <SetupScreen onConfigured={() => window.location.reload()} />;
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
