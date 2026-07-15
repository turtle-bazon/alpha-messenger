import React, { useState, useEffect, useRef } from 'react';

export interface LinkDialogProps {
  initialText: string;
  onInsert: (text: string, url: string) => void;
  onClose: () => void;
}

export function LinkDialog({
  initialText,
  onInsert,
  onClose,
}: LinkDialogProps): JSX.Element {
  const [text, setText] = useState(initialText);
  const [url, setUrl] = useState('');
  const urlRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // Фокус на поле URL при открытии
    urlRef.current?.focus();
  }, []);

  function handleSubmit(e: React.FormEvent): void {
    e.preventDefault();
    if (text.trim() && url.trim()) {
      onInsert(text.trim(), url.trim());
      onClose();
    }
  }

  return (
    <div className="link-dialog-backdrop" data-testid="link-dialog">
      <div className="link-dialog">
        <h3>Вставить ссылку</h3>
        <form onSubmit={handleSubmit}>
          <label>
            Текст
            <input
              type="text"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Текст ссылки"
              data-testid="link-text"
            />
          </label>
          <label>
            URL
            <input
              ref={urlRef}
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://example.com"
              required
              data-testid="link-url"
            />
          </label>
          <div className="link-dialog-buttons">
            <button type="button" onClick={onClose}>
              Отмена
            </button>
            <button type="submit" disabled={!text.trim() || !url.trim()}>
              Вставить
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
