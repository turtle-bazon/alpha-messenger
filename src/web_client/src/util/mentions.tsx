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

// ─── Markdown + ссылки ───────────────────────────────────────────────

interface Token {
  type: 'text' | 'code' | 'bold' | 'italic' | 'strike' | 'link' | 'url' | 'mention';
  value: string;
  url?: string; // для link и url
  key: number;
}

// Извлекаем inline-code, чтобы внутри не парсить остальное.
function extractCodeSpans(text: string): { parts: string[]; codes: string[] } {
  const parts: string[] = [];
  const codes: string[] = [];
  const codeRe = /`([^`]+)`/g;
  let lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = codeRe.exec(text)) !== null) {
    if (m.index > lastIndex) parts.push(text.slice(lastIndex, m.index));
    parts.push(`\x00CODE${codes.length}\x00`);
    codes.push(m[1]);
    lastIndex = m.index + m[0].length;
  }
  if (lastIndex < text.length) parts.push(text.slice(lastIndex));
  return { parts, codes };
}

// Токенизация текста (без code-spans).
function tokenize(text: string, usernames: Set<string>): Token[] {
  const tokens: Token[] = [];
  let key = 0;

  // Паттерны в порядке приоритета:
  // 1. [текст](url) — явная ссылка
  // 2. **bold**
  // 3. _italic_
  // 4. ~~strike~~
  // 5. URL
  // 6. @mention
  const combined =
    /\[([^\]]+)\]\(([^)]+)\)|\*\*(.+?)\*\*|_(.+?)_ |~~(.+?)~~|(https?:\/\/[^\s<>"')]+(?:\([^\s<>"']*\))?)|@([a-zA-Z0-9_]{1,32})/g;

  let lastIndex = 0;
  let m: RegExpExecArray | null;

  while ((m = combined.exec(text)) !== null) {
    // Текст перед совпадением
    if (m.index > lastIndex) {
      tokens.push({ type: 'text', value: text.slice(lastIndex, m.index), key: key++ });
    }

    if (m[1] !== undefined && m[2] !== undefined) {
      // [текст](url)
      tokens.push({ type: 'link', value: m[1], url: m[2], key: key++ });
    } else if (m[3] !== undefined) {
      // **bold**
      tokens.push({ type: 'bold', value: m[3], key: key++ });
    } else if (m[4] !== undefined) {
      // _italic_
      tokens.push({ type: 'italic', value: m[4], key: key++ });
    } else if (m[5] !== undefined) {
      // ~~strike~~
      tokens.push({ type: 'strike', value: m[5], key: key++ });
    } else if (m[6] !== undefined) {
      // URL
      let url = m[6];
      // Обрезаем конечные знаки препинания, которые не часть URL
      url = url.replace(/[.,;:!?)]+$/, '');
      tokens.push({ type: 'url', value: url, url, key: key++ });
    } else if (m[7] !== undefined) {
      // @mention
      if (usernames.has(m[7])) {
        tokens.push({ type: 'mention', value: '@' + m[7], key: key++ });
      } else {
        tokens.push({ type: 'text', value: '@' + m[7], key: key++ });
      }
    }

    lastIndex = m.index + m[0].length;
  }

  if (lastIndex < text.length) {
    tokens.push({ type: 'text', value: text.slice(lastIndex), key: key++ });
  }

  return tokens;
}

// Рендер токена в React-элемент.
function renderToken(
  t: Token,
  onMentionClick?: (username: string) => void,
): React.ReactNode {
  switch (t.type) {
    case 'text':
      return t.value;
    case 'code':
      return <code key={t.key} className="message-code">{t.value}</code>;
    case 'bold':
      return <strong key={t.key}>{t.value}</strong>;
    case 'italic':
      return <em key={t.key}>{t.value}</em>;
    case 'strike':
      return <del key={t.key}>{t.value}</del>;
    case 'link':
      return (
        <a
          key={t.key}
          className="message-link"
          href={t.url}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
        >
          {t.value}
        </a>
      );
    case 'url':
      return (
        <a
          key={t.key}
          className="message-link"
          href={t.url}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
        >
          {t.value}
        </a>
      );
    case 'mention':
      return (
        <span
          key={t.key}
          className="mention-highlight"
          data-mention={t.value.slice(1)}
          onClick={(e) => {
            e.stopPropagation();
            onMentionClick?.(t.value.slice(1));
          }}
        >
          {t.value}
        </span>
      );
  }
}

// Главная функция: рендер markdown + ссылки + @mentions.
export function renderMessageText(
  text: string,
  usernames: Set<string>,
  onMentionClick?: (username: string) => void,
): React.ReactNode[] {
  if (!text) return [];

  // 1. Извлекаем code-spans
  const { parts, codes } = extractCodeSpans(text);

  // 2. Для каждой части (кроме плейсхолдеров кода) — токенизация
  const result: React.ReactNode[] = [];
  for (const part of parts) {
    const codeMatch = part.match(/^\x00CODE(\d+)\x00$/);
    if (codeMatch) {
      // Восстанавливаем код как есть
      result.push(
        <code key={`code-${codeMatch[1]}`} className="message-code">
          {codes[Number(codeMatch[1])]}
        </code>,
      );
    } else {
      // Токенизируем и рендерим
      const tokens = tokenize(part, usernames);
      for (const t of tokens) {
        result.push(renderToken(t, onMentionClick));
      }
    }
  }

  return result.length > 0 ? result : [text];
}
