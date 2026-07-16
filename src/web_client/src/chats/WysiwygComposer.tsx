import React, { useRef, useEffect, useCallback, forwardRef, useImperativeHandle } from 'react';

// ─── Markdown → HTML (для рендера в overlay-div) ────────────────────

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

// ─── Types ───────────────────────────────────────────────────────────

export interface WysiwygComposerHandle {
  getMarkdown: () => string;
  setMarkdown: (md: string) => void;
}

export interface WysiwygComposerProps {
  value: string;
  onChange: (value: string) => void;
  onKeyDown?: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  onPaste?: (e: React.ClipboardEvent<HTMLTextAreaElement>) => void;
  onSelect?: (selectionStart: number, selectionEnd: number) => void;
  textareaRef: React.RefObject<HTMLTextAreaElement>;
  usernames: Set<string>;
  placeholder?: string;
  'data-testid'?: string;
}

// ─── Компонент ───────────────────────────────────────────────────────
//
// Два слоя:
// 1. Textarea (z-index 2, opacity 0) — принимает ввод, хранит raw-текст
// 2. Div (z-index 1, pointer-events none) — рендерит отформатированный HTML
//
// Пользователь видит ТОЛЬКО div. Textarea невидима, но получает фокус и ввод.

export const WysiwygComposer = forwardRef<WysiwygComposerHandle, WysiwygComposerProps>(
  function WysiwygComposer(
    {
      value,
      onChange,
      onKeyDown,
      onPaste,
      onSelect,
      textareaRef,
      usernames: _usernames,
      placeholder = 'Сообщение…',
      'data-testid': testId = 'message-input',
    },
    ref,
  ): JSX.Element {
    const overlayRef = useRef<HTMLDivElement>(null);
    const isProgrammaticRef = useRef(false);

    // Expose getMarkdown / setMarkdown
    useImperativeHandle(ref, () => ({
      getMarkdown(): string { return textareaRef.current?.value ?? ''; },
      setMarkdown(md: string): void {
        const ta = textareaRef.current;
        if (!ta) return;
        isProgrammaticRef.current = true;
        ta.value = md;
        onChange(md);
        isProgrammaticRef.current = false;
      },
    }));

    // Рендер markdown → overlay div при изменении value
    useEffect(() => {
      const overlay = overlayRef.current;
      if (!overlay) return;
      if (isProgrammaticRef.current) return;
      overlay.innerHTML = value ? markdownToHtml(value) : '';
    }, [value]);

    // Ввод текста → передаём родителю
    const handleInput = useCallback(() => {
      const ta = textareaRef.current;
      if (!ta) return;
      onChange(ta.value);
    }, [textareaRef, onChange]);

    // Выделение текста → позиция для тулбара форматирования
    const handleSelect = useCallback(() => {
      if (!onSelect) return;
      const ta = textareaRef.current;
      if (!ta) return;
      onSelect(ta.selectionStart, ta.selectionEnd);
    }, [textareaRef, onSelect]);

    // Синхронизация скролла textarea → overlay
    const handleScroll = useCallback(() => {
      const ta = textareaRef.current;
      const ov = overlayRef.current;
      if (ta && ov) ov.scrollTop = ta.scrollTop;
    }, [textareaRef]);

    return (
      <div className="composer-wrapper">
        {/* Overlay: видимый слой с отрендеренным HTML */}
        <div
          ref={overlayRef}
          className="composer-overlay"
          aria-hidden="true"
        />
        {/* Textarea: невидимый, но получает фокус и ввод */}
        <textarea
          ref={textareaRef}
          className="composer-textarea"
          data-testid={testId}
          placeholder={placeholder}
          rows={1}
          onInput={handleInput}
          onKeyDown={onKeyDown as React.KeyboardEventHandler<HTMLTextAreaElement>}
          onPaste={onPaste as React.ClipboardEventHandler<HTMLTextAreaElement>}
          onSelect={handleSelect}
          onClick={handleSelect}
          onScroll={handleScroll}
        />
      </div>
    );
  },
);
