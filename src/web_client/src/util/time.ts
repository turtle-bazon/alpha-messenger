// Time formatting for the UI (modeled after desktop Telegram).

import i18n, { intlLocale } from '../i18n';

export function formatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString(intlLocale(), { hour: '2-digit', minute: '2-digit' });
}

// Time for the chat list: hh:mm today, otherwise a dd.mm date.
export function formatListTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return formatTime(iso);
  return d.toLocaleDateString(intlLocale(), { day: '2-digit', month: '2-digit' });
}

// Whether two timestamps share a calendar day (for grouping messages and date dividers).
export function sameDay(a: string, b: string): boolean {
  const da = new Date(a);
  const db = new Date(b);
  if (Number.isNaN(da.getTime()) || Number.isNaN(db.getTime())) return false;
  return da.toDateString() === db.toDateString();
}

// Date divider label in a conversation: "Today", "Yesterday", "June 24"
// (with the year if the message isn't from the current year).
export function formatDateDivider(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return i18n.t('time.today');
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return i18n.t('time.yesterday');
  const opts: Intl.DateTimeFormatOptions =
    d.getFullYear() === now.getFullYear()
      ? { day: 'numeric', month: 'long' }
      : { day: 'numeric', month: 'long', year: 'numeric' };
  return d.toLocaleDateString(intlLocale(), opts);
}

// Formatting of "last seen" (#36).
export function formatLastSeen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const now = Date.now();
  const diff = now - d.getTime();
  const mins = Math.floor(diff / 60_000);
  const hours = Math.floor(diff / 3_600_000);
  const days = Math.floor(diff / 86_400_000);

  if (mins < 1) return i18n.t('time.justNow');
  if (mins < 60) return i18n.t('time.lastSeenMin', { n: mins });
  if (hours < 24) return i18n.t('time.lastSeenHour', { n: hours });
  if (days < 7) return i18n.t('time.lastSeenDay', { n: days });
  if (days < 30) {
    const weeks = Math.floor(days / 7);
    return i18n.t('time.lastSeenWeek', {
      n: weeks,
      date: d.toLocaleDateString(intlLocale(), { day: '2-digit', month: '2-digit', year: 'numeric' }),
    });
  }
  return i18n.t('time.lastSeenDate', {
    date: d.toLocaleDateString(intlLocale(), { day: '2-digit', month: '2-digit', year: 'numeric' }),
  });
}
