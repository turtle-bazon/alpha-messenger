// Базовый адрес сервера. Вычисляется динамически.
// На Android нативное приложение записывает settings.js с window.__ALPHA_CONFIG__,
// поэтому URL доступен синхронно — без evaluateJavascript и localStorage.
function getApiUrl(): string {
  if (typeof window === 'undefined') return 'http://localhost:3000';

  // 1. Нативный мост (Android settings.js) — приоритет на file:// протоколе
  const native = (window as any).__ALPHA_CONFIG__?.serverUrl;
  if (native) return native;

  // 2. localStorage (пользователь вводит адрес)
  const saved = localStorage.getItem('alpha.serverUrl');
  if (saved) return saved;

  // 3. Явно заданный адрес (для dev или нестандартных портов)
  if (import.meta.env.VITE_API_URL) return import.meta.env.VITE_API_URL;

  // 4. Тот же origin (Apache/nginx reverse proxy).
  // На file:// протоколе origin = 'null' — фолбэк на localhost.
  if (window.location.origin && window.location.origin !== 'null') {
    return window.location.origin;
  }

  return 'http://localhost:3000';
}

// Все REST-эндпоинты живут под /api/ (см. app.ts). Префикс держим здесь —
// единый источник, чтобы пути в rest.ts оставались короткими (/auth/..., /chats).
export function apiUrl(path: string): string {
  return `${getApiUrl()}/api${path}`;
}

// ws:// (или wss://) для потока событий.
export function wsUrl(): string {
  const api = getApiUrl();
  if (api) return `${api.replace(/^http/, 'ws')}/ws`;
  const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${window.location.host}/ws`;
}
