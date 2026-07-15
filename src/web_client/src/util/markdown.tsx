import React from 'react';

// ─── Типы ────────────────────────────────────────────────────────────

interface Token {
  type: 'text' | 'code' | 'bold' | 'italic' | 'strike' | 'link' | 'url' | 'mention';
  value: string;
  url?: string;
}

// ─── Pass 1: Извлечение code-spans ───────────────────────────────────

function extractCodeSpans(text: string): { result: string; codes: string[] } {
  const codes: string[] = [];
  const result = text.replace(/`([^`]+)`/g, (_, code) => {
    const idx = codes.length;
    codes.push(code);
    return `\x00C${idx}\x00`;
  });
  return { result, codes };
}

// ─── Pass 2: Токенизация ─────────────────────────────────────────────

// Проверяет, что позиция стоит на границе слова (не в середине лексемы).
function isWordBoundary(text: string, pos: number): boolean {
  if (pos === 0) return true;
  if (pos >= text.length) return true;
  const prev = text[pos - 1];
  const next = text[pos];
  const wordChar = /[a-zA-Z0-9_]/;
  const prevIsWord = wordChar.test(prev);
  const nextIsWord = wordChar.test(next);
  return prevIsWord !== nextIsWord;
}

// Ищет закрывающий маркер, пропуская экранированные символы.
function findClosing(text: string, start: number, marker: string): number {
  let i = start;
  while (i < text.length) {
    if (text[i] === '\\') {
      i += 2; // пропускаем экранированный символ
      continue;
    }
    if (text.startsWith(marker, i)) return i;
    i++;
  }
  return -1;
}

// Извлекает username после @.
function matchUsername(text: string, pos: number): string | null {
  const m = text.slice(pos).match(/^@([a-zA-Z0-9_]{1,32})/);
  return m ? m[1] : null;
}

// Извлекает URL, обрезая конечную пунктуацию.
function matchUrl(text: string, pos: number): string | null {
  const m = text.slice(pos).match(/^https?:\/\/[^\s<>"')]+/);
  if (!m) return null;
  let url = m[0];
  // Обрезаем конечные знаки препинания, которые не часть URL
  url = url.replace(/[.,;:!?)]+$/, '');
  return url || null;
}

function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;

  while (i < text.length) {
    // Code-spans (плейсхолдеры)
    if (text[i] === '\x00') {
      const m = text.slice(i).match(/^\x00C(\d+)\x00/);
      if (m) {
        tokens.push({ type: 'code', value: m[1] }); // value = индекс в массиве codes
        i += m[0].length;
        continue;
      }
    }

    // **bold**
    if (text.startsWith('**', i)) {
      const end = findClosing(text, i + 2, '**');
      if (end > i + 2) {
        const content = text.slice(i + 2, end);
        if (content.trim()) {
          tokens.push({ type: 'bold', value: content });
          i = end + 2;
          continue;
        }
      }
    }

    // _italic_ (только на границе слова)
    if (text[i] === '_' && isWordBoundary(text, i)) {
      const end = findClosing(text, i + 1, '_');
      if (end > i + 1 && isWordBoundary(text, end + 1)) {
        const content = text.slice(i + 1, end);
        if (content.trim()) {
          tokens.push({ type: 'italic', value: content });
          i = end + 1;
          continue;
        }
      }
    }

    // ~~strike~~
    if (text.startsWith('~~', i)) {
      const end = findClosing(text, i + 2, '~~');
      if (end > i + 2) {
        const content = text.slice(i + 2, end);
        if (content.trim()) {
          tokens.push({ type: 'strike', value: content });
          i = end + 2;
          continue;
        }
      }
    }

    // [текст](url) — markdown-ссылка
    if (text[i] === '[') {
      const closeBracket = findClosing(text, i + 1, ']');
      if (closeBracket > i + 1 && text[closeBracket + 1] === '(') {
        const closeParen = findClosing(text, closeBracket + 2, ')');
        if (closeParen > closeBracket + 2) {
          const linkText = text.slice(i + 1, closeBracket);
          const url = text.slice(closeBracket + 2, closeParen);
          if (linkText.trim() && url.trim()) {
            tokens.push({ type: 'link', value: linkText, url });
            i = closeParen + 1;
            continue;
          }
        }
      }
    }

    // https://... — автодетект URL
    if (text.startsWith('http://', i) || text.startsWith('https://', i)) {
      const url = matchUrl(text, i);
      if (url) {
        tokens.push({ type: 'url', value: url, url });
        i += url.length;
        continue;
      }
    }

    // @username
    if (text[i] === '@') {
      const username = matchUsername(text, i);
      if (username) {
        tokens.push({ type: 'mention', value: username });
        i += username.length + 1; // +1 для @
        continue;
      }
    }

    // Plain text — собираем до следующего спецсимвола
    let end = i + 1;
    while (end < text.length) {
      const ch = text[end];
      if (ch === '\\' || ch === '*' || ch === '_' || ch === '~' ||
          ch === '[' || ch === '`' || ch === '@' || ch === '\x00' ||
          (ch === 'h' && (text.slice(end, end + 7) === 'http://' || text.slice(end, end + 8) === 'https://'))) {
        break;
      }
      end++;
    }
    tokens.push({ type: 'text', value: text.slice(i, end) });
    i = end;
  }

  return tokens;
}

// ─── Pass 3: Сборка React elements ───────────────────────────────────

function renderToken(
  t: Token,
  codes: string[],
  usernames: Set<string>,
  onMentionClick?: (username: string) => void,
): React.ReactNode {
  switch (t.type) {
    case 'text':
      return t.value;
    case 'code':
      return <code key={`code-${t.value}`} className="message-code">{codes[Number(t.value)]}</code>;
    case 'bold':
      return <strong key={`bold-${t.value.slice(0, 8)}`}>{t.value}</strong>;
    case 'italic':
      return <em key={`italic-${t.value.slice(0, 8)}`}>{t.value}</em>;
    case 'strike':
      return <del key={`strike-${t.value.slice(0, 8)}`}>{t.value}</del>;
    case 'link':
      return (
        <a
          key={`link-${t.url}`}
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
          key={`url-${t.url}`}
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
      if (usernames.has(t.value)) {
        return (
          <span
            key={`mention-${t.value}`}
            className="mention-highlight"
            data-mention={t.value}
            onClick={(e) => {
              e.stopPropagation();
              onMentionClick?.(t.value);
            }}
          >
            @{t.value}
          </span>
        );
      }
      return `@${t.value}`;
  }
}

// ─── Главная функция ─────────────────────────────────────────────────

export function renderMarkdown(
  text: string,
  usernames: Set<string>,
  onMentionClick?: (username: string) => void,
): React.ReactNode[] {
  if (!text) return [];

  // Pass 1: извлекаем code-spans
  const { result, codes } = extractCodeSpans(text);

  // Pass 2: токенизируем
  const tokens = tokenize(result);

  // Pass 3: собираем React elements
  const elements = tokens.map((t) => renderToken(t, codes, usernames, onMentionClick));

  return elements.length > 0 ? elements : [text];
}
