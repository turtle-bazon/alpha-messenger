// Color theme: light/dark. The value is stored in localStorage; if nothing is
// saved, the system preference is used (prefers-color-scheme).
// Applied via data-theme on <html> (the palette is overridden in CSS).

export type Theme = 'light' | 'dark';

const KEY = 'theme';

export function getTheme(): Theme {
  const saved = localStorage.getItem(KEY);
  if (saved === 'light' || saved === 'dark') return saved;
  return window.matchMedia('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light';
}

export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
}

export function setTheme(theme: Theme): void {
  localStorage.setItem(KEY, theme);
  applyTheme(theme);
}

// Apply the initial theme right at module import — before the first render,
// so dark-theme users don't get a light flash.
applyTheme(getTheme());
