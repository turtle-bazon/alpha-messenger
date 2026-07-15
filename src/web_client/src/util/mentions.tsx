import React from 'react';
import { renderMarkdown } from './markdown';

// ─── Обратная совместимость ──────────────────────────────────────────

// Старая функция — теперь обёртка над renderMarkdown.
// Оставлена для совместимости с существующими вызовами.
export function renderMentionText(
  text: string,
  usernames: Set<string>,
  onMentionClick?: (username: string) => void,
): React.ReactNode[] {
  return renderMarkdown(text, usernames, onMentionClick);
}

// ─── Основной экспорт ────────────────────────────────────────────────

// Рендер markdown + ссылки + @mentions.
// Поддерживает: **bold**, _italic_, ~~strike~~, `code`, [text](url),
// автодетект URL, @mentions.
// Code-spans защищены от парсинга внутри.
export { renderMarkdown as renderMessageText } from './markdown';
