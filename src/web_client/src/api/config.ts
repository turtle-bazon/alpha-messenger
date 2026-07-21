// Базовый адрес сервера. Вычисляется динамически — на Android localStorage
// заполняется evaluateJavascript после загрузки модуля, поэтому кешировать
// URL на уровне модуля нельзя.
function getApiUrl(): string {
  // Приоритет — localStorage (пользователь вводит адрес; на Android передаётся из нативного кода)
  if (typeof window !== 'undefined') {
    const saved = localStorage.getItem('alpha.serverUrl');
    // DEBUG: показываем что читаем из localStorage
    console.log('[config] localStorage alpha.serverUrl =', JSON.stringify(saved));
    console.log('[config] window.location.origin =', window.location.origin);
    console.log('[config] window.location.protocol =', window.location.protocol);
    if (saved) return saved;
  }

  // Явно заданный адрес (для dev или нестандартных портов)
  if (import.meta.env.VITE_API_URL) return import.meta.env.VITE_API_URL;

  // По умолчанию — тот же origin (Apache/nginx reverse proxy).
  // На file:// протоколе (bundled клиент в Capacitor) origin null — фолбэк на localhost.
  if (typeof window !== 'undefined' && window.location.origin && window.location.origin !== 'null') {
    return window.location.origin;
  }

  return 'http://localhost:3000';
}

// Все REST-эндпоинты живут под /api/ (см. app.ts). Префикс держим здесь —
// единый источник, чтобы пути в rest.ts оставались короткими (/auth/..., /chats).
export function apiUrl(path: string): string {
  const base = getApiUrl();
  const url = `${base}/api${path}`;
  console.log('[config] apiUrl →', url);
  return url;
}

// ws:// (или wss://) для потока событий.
export function wsUrl(): string {
  const api = getApiUrl();
  if (api) return `${api.replace(/^http/, 'ws')}/ws`;
  const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${window.location.host}/ws`;
}
