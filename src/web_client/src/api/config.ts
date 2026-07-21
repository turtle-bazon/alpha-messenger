// Базовый адрес сервера. Вычисляется динамически.
// На Android используется addJavascriptInterface (window.AlphaConfig.getServerUrl()) —
// синхронный мост, доступен ДО загрузки任何 скриптов.
// Дополнительно settings.js ставит window.__ALPHA_CONFIG__ для cached клиента.
function getApiUrl(): string {
  if (typeof window === 'undefined') return 'http://localhost:3000';

  // 1. addJavascriptInterface (Android native bridge) — самый надёжный, работает всегда
  const native = (window as any).AlphaConfig?.getServerUrl();
  if (native) return native;

  // 2. settings.js (Android cached client — файл в той же директории)
  const cached = (window as any).__ALPHA_CONFIG__?.serverUrl;
  if (cached) return cached;

  // 3. localStorage (desktop, web-setup fallback)
  const saved = localStorage.getItem('alpha.serverUrl');
  if (saved) return saved;

  // 4. Явно заданный адрес (для dev или нестандартных портов)
  if (import.meta.env.VITE_API_URL) return import.meta.env.VITE_API_URL;

  // 5. Тот же origin (Apache/nginx reverse proxy).
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
