// Линейные иконки (inline SVG, красятся через currentColor) — единый стиль,
// тонкая линия как в Telegram Desktop. Эмодзи намеренно не используем: их глифы
// различаются между ОС. Декоративные, поэтому aria-hidden.

interface IconProps {
  size?: number;
}

function svgProps(size: number) {
  return {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
  };
}

export function IconSearch({ size = 18 }: IconProps): JSX.Element {
  return (
    <svg {...svgProps(size)}>
      <circle cx="11" cy="11" r="7" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  );
}

// Бумажный самолётик (отправка).
export function IconSend({ size = 22 }: IconProps): JSX.Element {
  return (
    <svg {...svgProps(size)}>
      <path d="M22 2 11 13" />
      <path d="M22 2 15 22l-4-9-9-4 20-7z" />
    </svg>
  );
}

// Галочки прочтения (задача #24). Тонкий контур (как в Telegram Desktop), без
// заливки. Одиночная — «отправлено»; двойная — «прочитано» (красится синим
// через класс .is-read у родителя). Свой viewBox/strokeWidth, чтобы на 14–16px
// линия была ~1.5px и аккуратной.
function checkProps(size: number) {
  return {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2.5,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
  };
}

// Одиночная галочка (отправлено).
export function IconCheck({ size = 15 }: IconProps): JSX.Element {
  return (
    <svg {...checkProps(size)}>
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

// Двойная галочка (прочитано). Чуть шире одиночной.
export function IconChecks({ size = 17 }: IconProps): JSX.Element {
  return (
    <svg {...checkProps(size)}>
      <path d="M18 6 7 17l-5-5" />
      <path d="m22 10-7.5 7.5L13 16" />
    </svg>
  );
}

// Скрепка (вложение).
export function IconAttach({ size = 22 }: IconProps): JSX.Element {
  return (
    <svg {...svgProps(size)}>
      <path d="M21.44 11.05 12 20.49a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
    </svg>
  );
}

export function IconMoon({ size = 18 }: IconProps): JSX.Element {
  return (
    <svg {...svgProps(size)}>
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  );
}

export function IconSun({ size = 18 }: IconProps): JSX.Element {
  return (
    <svg {...svgProps(size)}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
    </svg>
  );
}

// Колокольчик (уведомления включены).
export function IconBell({ size = 18 }: IconProps): JSX.Element {
  return (
    <svg {...svgProps(size)}>
      <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
    </svg>
  );
}

// Перечёркнутый колокольчик (уведомления выключены).
export function IconBellOff({ size = 18 }: IconProps): JSX.Element {
  return (
    <svg {...svgProps(size)}>
      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
      <path d="M18.63 13A17.9 17.9 0 0 1 18 8" />
      <path d="M6.26 6.26A5.86 5.86 0 0 0 6 8c0 7-3 9-3 9h14" />
      <path d="M18 8a6 6 0 0 0-9.33-5" />
      <line x1="1" y1="1" x2="23" y2="23" />
    </svg>
  );
}
