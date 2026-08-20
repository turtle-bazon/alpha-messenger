import React from 'react';
import { renderMarkdown } from './markdown';

// ─── Backward compatibility ──────────────────────────────────────────

// Legacy function — now a wrapper over renderMarkdown.
// Kept for compatibility with existing callers.
export function renderMentionText(
  text: string,
  usernames: Set<string>,
  onMentionClick?: (username: string) => void,
): React.ReactNode[] {
  return renderMarkdown(text, usernames, onMentionClick);
}

// ─── Main export ─────────────────────────────────────────────────────

// Markdown rendering + links + @mentions.
// Supports: **bold**, _italic_, ~~strike~~, `code`, [text](url),
// autodetected URLs, @mentions.
// Code-spans are protected from parsing inside.
export { renderMarkdown as renderMessageText } from './markdown';
