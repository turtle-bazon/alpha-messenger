import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Chat } from '../api/types';
import { chatTitle } from './chatTitle';
import { colorFor, initialFor } from './avatar';
import { IconX } from '../util/icons';

// Chat picker for forwarding a message (#84). Shown at HomeScreen level where
// the chat list lives. Filter by title, click to forward.

export function ForwardDialog({
  chats,
  myId,
  onPick,
  onClose,
}: {
  chats: Chat[];
  myId: string | null;
  onPick: (chatId: string) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = [...chats].sort((a, b) =>
      a.updatedAt < b.updatedAt ? 1 : -1,
    );
    if (!q) return list;
    return list.filter((c) => chatTitle(c, myId).toLowerCase().includes(q));
  }, [chats, myId, query]);

  return (
    <div className="img-editor-backdrop gallery-backdrop" data-testid="forward-dialog">
      <div className="gallery-dialog forward-dialog">
        <header className="gallery-header">
          <span className="gallery-title">{t('forward.title')}</span>
          <button
            type="button"
            className="gallery-close"
            aria-label={t('common.close')}
            onClick={onClose}
          >
            <IconX />
          </button>
        </header>
        <div className="forward-search">
          <input
            ref={inputRef}
            data-testid="forward-search"
            placeholder={t('forward.searchPlaceholder')}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <div className="forward-list">
          {filtered.length === 0 && (
            <div className="gallery-empty">{t('forward.notFound')}</div>
          )}
          {filtered.map((c) => (
            <button
              key={c.chatId}
              type="button"
              className="forward-item"
              data-testid="forward-item"
              onClick={() => onPick(c.chatId)}
            >
              <span
                className="forward-avatar"
                style={{ background: colorFor(chatTitle(c, myId)) }}
              >
                {initialFor(chatTitle(c, myId))}
              </span>
              <span className="forward-name">{chatTitle(c, myId)}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
