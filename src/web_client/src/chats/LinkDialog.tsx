import React, { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

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
  const { t } = useTranslation();
  const [text, setText] = useState(initialText);
  const [url, setUrl] = useState('');
  const urlRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // Focus the URL field on open
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
        <h3>{t('composer.linkDialogTitle')}</h3>
        <form onSubmit={handleSubmit}>
          <label>
            {t('composer.linkText')}
            <input
              type="text"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={t('composer.linkTextPlaceholder')}
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
              {t('common.cancel')}
            </button>
            <button type="submit" disabled={!text.trim() || !url.trim()}>
              {t('composer.linkInsert')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
