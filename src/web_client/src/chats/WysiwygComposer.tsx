import React, { useRef, useEffect, useCallback } from 'react';
import { renderMarkdown } from '../util/markdown';

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

export function WysiwygComposer({
  value,
  onChange,
  onKeyDown,
  onPaste,
  onSelect,
  textareaRef,
  usernames,
  placeholder = 'Сообщение…',
  'data-testid': testId = 'message-input',
}: WysiwygComposerProps): JSX.Element {
  const overlayRef = useRef<HTMLDivElement>(null);

  // Синхронизация скролла textarea → overlay
  const syncScroll = useCallback(() => {
    const textarea = textareaRef.current;
    const overlay = overlayRef.current;
    if (textarea && overlay) {
      overlay.scrollTop = textarea.scrollTop;
      overlay.scrollLeft = textarea.scrollLeft;
    }
  }, [textareaRef]);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.addEventListener('scroll', syncScroll);
      return () => textarea.removeEventListener('scroll', syncScroll);
    }
  }, [textareaRef, syncScroll]);

  // Обработка выделения текста — используем onClick + onKeyUp вместо onSelect
  // (React onSelect на textarea ненадёжный).
  const checkSelection = useCallback(() => {
    const textarea = textareaRef.current;
    if (textarea && onSelect) {
      onSelect(textarea.selectionStart, textarea.selectionEnd);
    }
  }, [textareaRef, onSelect]);

  // Рендер markdown для overlay
  const renderedContent = value ? renderMarkdown(value, usernames) : null;

  return (
    <div className="composer-wrapper">
      {/* Overlay с отрендеренным markdown */}
      <div
        ref={overlayRef}
        className="composer-rendered"
        aria-hidden="true"
      >
        {renderedContent}
        {!value && <span className="composer-placeholder">{placeholder}</span>}
      </div>

      {/* Скрытый textarea с raw markdown */}
      <textarea
        ref={textareaRef}
        className="composer-raw"
        data-testid={testId}
        aria-label="Сообщение"
        placeholder={placeholder}
        rows={1}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        onPaste={onPaste}
        onClick={checkSelection}
        onKeyUp={checkSelection}
      />
    </div>
  );
}
