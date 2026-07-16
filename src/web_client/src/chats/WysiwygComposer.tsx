import React, { useRef, useEffect, useCallback, forwardRef, useImperativeHandle } from 'react';

// ─── HTML → Markdown конвертер ───────────────────────────────────────
// Обходит DOM-ноды и конвертирует <strong> → **, <em> → _, и т.д.
// Вызывается при отправке и при синхронизации состояния.

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

// ─── Markdown → HTML (для начального рендера/восстановления черновика) ──

function markdownToHtml(md: string): string {
  let result = md;
  result = result.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  result = result.replace(/`([^`]+)`/g, '<code>$1</code>');
  result = result.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  result = result.replace(/_(.+?)_/g, '<em>$1</em>');
  result = result.replace(/~~(.+?)~~/g, '<del>$1</del>');
  result = result.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
  result = result.replace(/(https?:\/\/[^\s<>"']+)/g, '<a href="$1">$1</a>');
  result = result.replace(/\n/g, '<br>');
  return result;
}

// ─── Types ───────────────────────────────────────────────────────────

export interface WysiwygComposerHandle {
  getMarkdown: () => string;
  setMarkdown: (md: string) => void;
}

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

export const WysiwygComposer = forwardRef<WysiwygComposerHandle, WysiwygComposerProps>(
  function WysiwygComposer(
    {
      value,
      onChange,
      onKeyDown,
      onPaste,
      onSelect,
      divRef,
      usernames: _usernames,
      placeholder = 'Сообщение…',
      'data-testid': testId = 'message-input',
    },
    ref,
  ): JSX.Element {
    const lastValueRef = useRef(value);

    // Expose getMarkdown / setMarkdown родителю
    useImperativeHandle(ref, () => ({
      getMarkdown(): string {
        const el = divRef.current;
        if (!el) return '';
        return htmlToMarkdown(el.innerHTML);
      },
      setMarkdown(md: string): void {
        const el = divRef.current;
        if (!el) return;
        if (md) {
          el.innerHTML = markdownToHtml(md);
        } else {
          el.innerHTML = '';
        }
        lastValueRef.current = md;
      },
    }));

    // Синхронизация извне (восстановление черновика, отправленное сообщение → очистка).
    // Ключевой guard: если div в фокусе — НЕ трогаем innerHTML,
    // чтобы не ломать редактирование и не показывать raw markdown.
    useEffect(() => {
      const el = divRef.current;
      if (!el) return;
      // Пользователь редактирует — не вмешиваемся
      if (el === document.activeElement) return;
      // Значение не изменилось — пропускаем
      if (value === lastValueRef.current) return;
      lastValueRef.current = value;

      const html = value ? markdownToHtml(value) : '';
      if (el.innerHTML !== html) {
        el.innerHTML = html;
      }
    }, [value, divRef]);

    // Ввод текста — конвертируем innerHTML → markdown и передаём родителю.
    // useEffect-guard предотвращает обратную конвертацию (innerHTML overwrite),
    // потому что div в фокусе.
    const handleInput = useCallback(() => {
      const el = divRef.current;
      if (!el) return;
      const md = htmlToMarkdown(el.innerHTML);
      lastValueRef.current = md;
      onChange(md);
    }, [divRef, onChange]);

    // Выделение текста — определяем реальную позицию курсора/выделения
    // для видимости панели форматирования.
    const checkSelection = useCallback(() => {
      if (!onSelect) return;
      const el = divRef.current;
      if (!el) return;
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0) return;

      const range = sel.getRangeAt(0);
      const preRange = document.createRange();
      preRange.selectNodeContents(el);
      preRange.setEnd(range.startContainer, range.startOffset);
      const start = preRange.toString().length;
      const end = start + range.toString().length;
      onSelect(start, end);
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
  },
);
