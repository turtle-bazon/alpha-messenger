import React, { useRef, useEffect, useCallback } from 'react';

// ─── HTML → Markdown конвертер ───────────────────────────────────────

function htmlToMarkdown(html: string): string {
  const div = document.createElement('div');
  div.innerHTML = html;
  return nodeToMarkdown(div);
}

function nodeToMarkdown(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) {
    return node.textContent ?? '';
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return '';

  const el = node as HTMLElement;
  const tag = el.tagName.toLowerCase();
  const children = Array.from(el.childNodes).map(nodeToMarkdown).join('');

  switch (tag) {
    case 'strong':
    case 'b':
      return children.trim() ? `**${children}**` : '';
    case 'em':
    case 'i':
      return children.trim() ? `_${children}_` : '';
    case 'code':
      return `\`${children}\``;
    case 'del':
    case 's':
      return children.trim() ? `~~${children}~~` : '';
    case 'a': {
      const href = el.getAttribute('href') ?? '';
      return children.trim() ? `[${children}](${href})` : '';
    }
    case 'br':
      return '\n';
    case 'div':
    case 'p':
      return children + '\n';
    default:
      return children;
  }
}

// ─── Props ───────────────────────────────────────────────────────────

export interface WysiwygComposerProps {
  value: string;
  onChange: (value: string) => void;
  onKeyDown?: (e: React.KeyboardEvent<HTMLDivElement>) => void;
  onPaste?: (e: React.ClipboardEvent<HTMLDivElement>) => void;
  onSelect?: (selectionStart: number, selectionEnd: number) => void;
  divRef: React.RefObject<HTMLDivElement>;
  usernames: Set<string>;
  placeholder?: string;
  'data-testid'?: string;
}

// ─── Компонент ───────────────────────────────────────────────────────

export function WysiwygComposer({
  value,
  onChange,
  onKeyDown,
  onPaste,
  onSelect,
  divRef,
  usernames,
  placeholder = 'Сообщение…',
  'data-testid': testId = 'message-input',
}: WysiwygComposerProps): JSX.Element {
  const lastValueRef = useRef(value);

  // Рендер markdown → innerHTML при изменении value (снаружи)
  useEffect(() => {
    const el = divRef.current;
    if (!el) return;
    // Не обновляем innerHML если пользователь сейчас редактирует
    if (el === document.activeElement) return;
    // Не обновляем если значение не изменилось
    if (value === lastValueRef.current) return;
    lastValueRef.current = value;

    if (value) {
      // Конвертируем React elements обратно в HTML через renderToString
      // или просто вставляем как текст с форматированием
      el.innerHTML = '';
      const span = document.createElement('span');
      // Простой рендер: bold → <strong>, italic → <em>, etc.
      span.innerHTML = markdownToHtml(value);
      el.appendChild(span);
    } else {
      el.innerHTML = '';
    }
  }, [value, usernames, divRef]);

  // Обработка ввода
  const handleInput = useCallback(() => {
    const el = divRef.current;
    if (!el) return;
    const html = el.innerHTML;
    const md = htmlToMarkdown(html);
    lastValueRef.current = md;
    onChange(md);
  }, [divRef, onChange]);

  // Обработка выделения
  const checkSelection = useCallback(() => {
    const el = divRef.current;
    if (el && onSelect) {
      const sel = window.getSelection();
      if (sel && sel.rangeCount > 0) {
        // Приблизительная позиция — не точная, но достаточная для тулбара
        const text = el.textContent ?? '';
        onSelect(0, text.length);
      }
    }
  }, [divRef, onSelect]);

  return (
    <div className="composer-wrapper">
      <div
        ref={divRef}
        className="composer-editable"
        data-testid={testId}
        contentEditable
        role="textbox"
        aria-label="Сообщение"
        data-placeholder={placeholder}
        onInput={handleInput}
        onKeyDown={onKeyDown as React.KeyboardEventHandler<HTMLDivElement>}
        onPaste={onPaste as React.ClipboardEventHandler<HTMLDivElement>}
        onClick={checkSelection}
        onKeyUp={checkSelection}
        suppressContentEditableWarning
      />
    </div>
  );
}

// ─── Markdown → HTML (простой, для начального рендера) ───────────────

function markdownToHtml(md: string): string {
  let result = md;
  // Escape HTML
  result = result
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  // Code spans (сначала, чтобы внутри не парсить)
  result = result.replace(/`([^`]+)`/g, '<code>$1</code>');
  // Bold
  result = result.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  // Italic
  result = result.replace(/_(.+?)_/g, '<em>$1</em>');
  // Strikethrough
  result = result.replace(/~~(.+?)~~/g, '<del>$1</del>');
  // Links
  result = result.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
  // URLs
  result = result.replace(
    /(https?:\/\/[^\s<>"']+)/g,
    '<a href="$1">$1</a>',
  );
  // Newlines → <br>
  result = result.replace(/\n/g, '<br>');
  return result;
}
