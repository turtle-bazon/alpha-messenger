// Тема оформления: light/dark. Значение хранится в localStorage; при отсутствии
// сохранённого — берётся системное предпочтение (prefers-color-scheme).
// Применяется через data-theme на <html> (палитру переопределяет CSS).

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

// Применяем начальную тему сразу при импорте модуля — до первого рендера,
// чтобы не было вспышки светлой темы у пользователей с тёмной.
applyTheme(getTheme());
