// Форматирование времени для UI (ориентир — десктопный Telegram).

export function formatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
}

// Время для списка чатов: сегодня — часы:минуты, иначе — дата дд.мм.
export function formatListTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return formatTime(iso);
  return d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' });
}

// Один ли это календарный день (для группировки сообщений и разделителей дат).
export function sameDay(a: string, b: string): boolean {
  const da = new Date(a);
  const db = new Date(b);
  if (Number.isNaN(da.getTime()) || Number.isNaN(db.getTime())) return false;
  return da.toDateString() === db.toDateString();
}

// Подпись разделителя дат в переписке: «Сегодня», «Вчера», «24 июня»
// (с годом, если сообщение не из текущего года).
export function formatDateDivider(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return 'Сегодня';
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return 'Вчера';
  const opts: Intl.DateTimeFormatOptions =
    d.getFullYear() === now.getFullYear()
      ? { day: 'numeric', month: 'long' }
      : { day: 'numeric', month: 'long', year: 'numeric' };
  return d.toLocaleDateString('ru-RU', opts);
}

// Форматирование "последний раз был активен" (#36).
export function formatLastSeen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const now = Date.now();
  const diff = now - d.getTime();
  const mins = Math.floor(diff / 60_000);
  const hours = Math.floor(diff / 3_600_000);
  const days = Math.floor(diff / 86_400_000);

  if (mins < 1) return 'только что';
  if (mins < 60) return `был(а) ${mins} мин. назад`;
  if (hours < 24) return `был(а) ${hours} ч. назад`;
  if (days < 7) return `был(а) ${days} дн. назад`;
  if (days < 30) {
    const weeks = Math.floor(days / 7);
    return `был(а) ${weeks} нед. назад (${d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' })})`;
  }
  return `был(а) ${d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' })}`;
}
