// Base server address. Computed dynamically.
// On Android, addJavascriptInterface is used (window.AlphaConfig.getServerUrl()) —
// a synchronous bridge available BEFORE any scripts load.
// Additionally, settings.js sets window.__ALPHA_CONFIG__ for the cached client.
function getApiUrl(): string {
  if (typeof window === 'undefined') return 'http://localhost:3000';

  // 1. addJavascriptInterface (Android native bridge) — most reliable, always works
  const native = (window as any).AlphaConfig?.getServerUrl();
  if (native) return native;

  // 2. settings.js (Android cached client — file in the same directory)
  const cached = (window as any).__ALPHA_CONFIG__?.serverUrl;
  if (cached) return cached;

  // 3. localStorage (desktop, web-setup fallback)
  const saved = localStorage.getItem('alpha.serverUrl');
  if (saved) return saved;

  // 4. Explicitly set address (for dev or non-standard ports)
  if (import.meta.env.VITE_API_URL) return import.meta.env.VITE_API_URL;

  // 5. Same origin (Apache/nginx reverse proxy).
  // Under the file:// protocol origin = 'null' — fall back to localhost.
  if (window.location.origin && window.location.origin !== 'null') {
    return window.location.origin;
  }

  return 'http://localhost:3000';
}

// All REST endpoints live under /api/ (see app.ts). The prefix lives here —
// single source of truth, keeping paths in rest.ts short (/auth/..., /chats).
export function apiUrl(path: string): string {
  return `${getApiUrl()}/api${path}`;
}

// ws:// (or wss://) for the event stream.
export function wsUrl(): string {
  const api = getApiUrl();
  if (api) return `${api.replace(/^http/, 'ws')}/ws`;
  const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${window.location.host}/ws`;
}
