// Базовый адрес сервера. В dev и e2e — локальный стек (cross-origin :5173→:3000).
// В прод-сборке читаем из localStorage (десктоп) или используем VITE_API_URL.
function getApiUrl(): string {
  // В dev режиме используем VITE_API_URL
  if (import.meta.env.VITE_API_URL) {
    return import.meta.env.VITE_API_URL;
  }

  // В десктопе читаем из localStorage
  if (typeof window !== 'undefined') {
    const saved = localStorage.getItem('alpha.serverUrl');
    if (saved) return saved;
  }

  // Fallback
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
