// Базовый адрес сервера. В dev и e2e — локальный стек (cross-origin :5173→:3000).
// В прод-сборке VITE_API_URL='' (пусто) → адрес относительный, запросы идут на
// тот же origin, что и страница, а обратный прокси (Apache) разводит /api и /ws.
const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';

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
