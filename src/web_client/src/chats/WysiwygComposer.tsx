import React, { useRef, useEffect, useCallback, forwardRef, useImperativeHandle } from 'react';

// ─── Markdown → HTML ────────────────────────────────────────────────

function markdownToHtml(md: string): string {
  let r = md;
  r = r.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  r = r.replace(/`([^`]+)`/g, '<code>$1</code>');
  r = r.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  r = r.replace(/_(.+?)_/g, '<em>$1</em>');
  r = r.replace(/~~(.+?)~~/g, '<del>$1</del>');
  r = r.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
  r = r.replace(/(https?:\/\/[^\s<>"']+)/g, '<a href="$1">$1</a>');
  r = r.replace(/\n/g, '<br>');
  return r;
}

// ─── HTML → Markdown ────────────────────────────────────────────────

function htmlToMarkdown(html: string): string {
  const div = document.createElement('div');
  div.innerHTML = html;
  return nodeToMd(div);
}

function nodeToMd(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? '';
  if (node.nodeType !== Node.ELEMENT_NODE) return '';
  const el = node as HTMLElement;
  const tag = el.tagName.toLowerCase();
  const ch = Array.from(el.childNodes).map(nodeToMd).join('');
  switch (tag) {
    case 'strong': case 'b': return ch.trim() ? `**${ch}**` : '';
    case 'em': case 'i': return ch.trim() ? `_${ch}_` : '';
    case 'code': return `\`${ch}\``;
    case 'del': case 's': return ch.trim() ? `~~${ch}~~` : '';
    case 'a': { const h = el.getAttribute('href') ?? ''; return ch.trim() ? `[${ch}](${h})` : ''; }
    case 'br': return '\n';
    case 'div': case 'p': return ch + '\n';
    default: return ch;
  }
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
//
// Один contentEditable div. Пользователь видит отформатированный HTML.
// Markdown-состояние синхронизируется ТОЛЬКО при blur/send,
// чтобы не ломать innerHTML на каждом keystroke.

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
    const isUpdatingRef = useRef(false);

    useImperativeHandle(ref, () => ({
      getMarkdown(): string {
        const el = divRef.current;
        if (!el) return '';
        return htmlToMarkdown(el.innerHTML);
      },
      setMarkdown(md: string): void {
        const el = divRef.current;
        if (!el) return;
        isUpdatingRef.current = true;
        el.innerHTML = md ? markdownToHtml(md) : '';
        isUpdatingRef.current = false;
      },
    }));

    // Синхронизация извне (восстановление черновика, очистка после отправки).
    // При фокусе — НЕ трогаем innerHTML.
    useEffect(() => {
      const el = divRef.current;
      if (!el) return;
      if (el === document.activeElement) return;
      const html = value ? markdownToHtml(value) : '';
      if (el.innerHTML !== html) {
        isUpdatingRef.current = true;
        el.innerHTML = html;
        isUpdatingRef.current = false;
      }
    }, [value, divRef]);

    // Ввод текста — НЕ конвертируем innerHTML → markdown.
    // contentEditable = source of truth для отображения.
    // Markdown нужен только при blur/send (getMarkdown).
    const handleInput = useCallback(() => {
      // No-op: innerHTML обновляется браузером напрямую.
      // Состояние синхронизируется при blur/send.
    }, []);

    // При потере фокуса — конвертируем innerHTML → markdown и передаём родителю.
    const handleBlur = useCallback(() => {
      const el = divRef.current;
      if (!el) return;
      const md = htmlToMarkdown(el.innerHTML);
      onChange(md);
    }, [divRef, onChange]);

    // Выделение текста
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
      onSelect(preRange.toString().length, preRange.toString().length + range.toString().length);
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
          onBlur={handleBlur}
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
