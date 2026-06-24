// Базовый адрес сервера. В dev и e2e — локальный стек; в обёртках задаётся
// через VITE_API_URL на этапе сборки.
const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';

export function apiUrl(path: string): string {
  return `${API_URL}${path}`;
}

// ws:// (или wss://) выводится из API_URL — единый источник адреса.
export function wsUrl(): string {
  return `${API_URL.replace(/^http/, 'ws')}/ws`;
}
