// Базовый адрес сервера. В десктопе — из localStorage (setup.html),
// в web/CI — из VITE_API_URL (для обратной совместимости).
// По умолчанию — тот же origin, что и страница ( works behind reverse proxy).
function getApiUrl(): string {
  // Приоритет — localStorage (пользователь вводит адрес)
  if (typeof window !== 'undefined') {
    const saved = localStorage.getItem('alpha.serverUrl');
    if (saved) return saved;
  }

  // Явно заданный адрес (для dev или нестандартных портов)
  if (import.meta.env.VITE_API_URL) return import.meta.env.VITE_API_URL;

  // По умолчанию — тот же origin (Apache/nginx reverse proxy)
  if (typeof window !== 'undefined') return window.location.origin;

  return 'http://localhost:3000';
}

const API_URL = getApiUrl();

// Все REST-эндпоинты живут под /api/ (см. app.ts). Префикс держим здесь —
// единый источник, чтобы пути в rest.ts оставались короткими (/auth/..., /chats).
export function apiUrl(path: string): string {
  return `${API_URL}/api${path}`;
}

// ws:// (или wss://) для потока событий. Когда API_URL задан — выводим из него;
// когда пуст (прод, относительный режим) — берём origin из window.location,
// чтобы схема (ws/wss) и хост совпали с адресом страницы.
export function wsUrl(): string {
  if (API_URL) return `${API_URL.replace(/^http/, 'ws')}/ws`;
  const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${window.location.host}/ws`;
}
