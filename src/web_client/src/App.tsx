import { useState, useEffect } from 'react';
import { clearSession, getToken } from './api/session';
import { LoginScreen } from './auth/LoginScreen';
import { RegisterScreen } from './auth/RegisterScreen';
import { SetupScreen } from './auth/SetupScreen';
import { HomeScreen } from './HomeScreen';
import { PushWarningBanner } from './notifications/PushWarningBanner';
import { initPlatform, getPlatform } from './util/platform';

type View = 'login' | 'register';

// Загрузка web-клиента с сервера внутри WebView (Android).
// WebView остаётся тем же — браузер не открывается.
// <base href> резолвит относительные пути JS/CSS относительно сервера.
async function loadFromServer(serverUrl: string): Promise<void> {
  try {
    const r = await fetch(`${serverUrl}/index.html`);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const html = await r.text();
    // Вставляем <base href> перед </head>, чтобы относительные пути работали
    const base = `<base href="${serverUrl}/">`;
    const patched = html.replace(/<head([^>]*)>/i, `<head$1>${base}`);
    document.open();
    document.write(patched);
    document.close();
  } catch {
    // Сервер недоступен — работаем из bundled (ничего не делаем)
  }
}

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

  // На Android: если сервер настроен — загружаем web-клиент с сервера
  // (всегда актуальная версия, как desktop). Bundled www/ служит только
  // bootstrap'ом. Если сервер недоступен — работаем из bundled.
  const [needsSetup, setNeedsSetup] = useState(() => {
    if (getPlatform() !== 'android') return false;
    const saved = localStorage.getItem('alpha.serverUrl');
    if (saved) {
      // Загружаем index.html с сервера и заменяем текущий документ.
      // <base href> гарантирует, что все относительные пути (JS/CSS)
      // резолвятся относительно сервера, а не bundled https://localhost.
      // WebView остаётся тем же — браузер не открывается.
      loadFromServer(saved);
      return false;
    }
    return true;
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
          loadFromServer(url);
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
