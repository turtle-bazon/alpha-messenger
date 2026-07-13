import React from 'react';

// Рендерит текст сообщения, подсвечивая @username как ссылки.
// Возвращает массив React-элементов: обычный текст + styled mention spans.
export function renderMentionText(
  text: string,
  usernames: Set<string>,
  onMentionClick?: (username: string) => void,
): React.ReactNode[] {
  if (!text || usernames.size === 0) return [text];

  const result: React.ReactNode[] = [];
  // Regex: @username (латиница, цифры, _, 1-32 символа)
  const mentionRe = /@([a-zA-Z0-9_]{1,32})/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = mentionRe.exec(text)) !== null) {
    const username = match[1];
    if (usernames.has(username)) {
      if (match.index > lastIndex) {
        result.push(text.slice(lastIndex, match.index));
      }
      result.push(
        <span
          key={`mention-${match.index}`}
          className="mention-highlight"
          data-mention={username}
          onClick={(e) => {
            e.stopPropagation();
            onMentionClick?.(username);
          }}
        >
          @{username}
        </span>,
      );
      lastIndex = match.index + match[0].length;
    }
  }

  if (lastIndex < text.length) {
    result.push(text.slice(lastIndex));
  }

  return result.length > 0 ? result : [text];
}
