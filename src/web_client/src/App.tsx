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
  // и сохраняет URL в SharedPreferences. WebView загружает
  // web-клиент с сервера напрямую (см. MainActivity.java).
  // Если сервер не настроен — нативный UI, без WebView.
  // Когда WebView уже загрузился с сервера — localStorage пустой
  // (другой origin), но это нормально: API использует window.location.origin.
  const [needsSetup, setNeedsSetup] = useState(() => {
    if (getPlatform() !== 'android') return false;
    // На Android setup делает нативный SetupActivity.
    // Проверяем localStorage на случай если web-клиент загружен
    // из bundled (фолбэк) — тогда нужен web-setup.
    return !localStorage.getItem('alpha.serverUrl')
      && window.location.protocol === 'file:';
  });

  // Инициализация платформы (push, нативные плагины)
  useEffect(() => {
    initPlatform();
  }, []);

  // Setup screen — только на Android (пока нативный SetupActivity не реализован полностью)
  if (needsSetup) {
    return (
      <SetupScreen onConfigured={() => {
        setNeedsSetup(false);
        window.location.reload();
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
