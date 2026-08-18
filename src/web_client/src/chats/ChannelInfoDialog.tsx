import { useEffect, useRef, useState } from 'react';
import {
  updateChat,
  subscribeChannel,
  unsubscribeChannel,
  searchChannels,
  createChannel,
} from '../api/rest';
import type { Chat } from '../api/types';

// Channel info dialog — shown when clicking channel header.
interface ChannelInfoDialogProps {
  chat: Chat;
  myId: string;
  onClose: () => void;
  onUpdated: (chat: Chat) => void;
}

export function ChannelInfoDialog({ chat, myId, onClose, onUpdated }: ChannelInfoDialogProps): JSX.Element {
  const [title, setTitle] = useState(chat.title ?? '');
  const [description, setDescription] = useState(chat.description ?? '');
  const [editing, setEditing] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const isOwner = chat.createdBy === myId;
  const isSubscribed = chat.participants.some((p) => p.userId === myId);

  useEffect(() => {
    function handleClick(e: MouseEvent): void {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    function handleKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKey);
    };
  }, [onClose]);

  async function handleSave(): Promise<void> {
    const updated = await updateChat(chat.chatId, { title, description });
    onUpdated(updated);
    setEditing(false);
  }

  async function handleSubscribe(): Promise<void> {
    await subscribeChannel(chat.chatId);
    onUpdated({ ...chat, subscriberCount: chat.subscriberCount + 1 });
  }

  async function handleUnsubscribe(): Promise<void> {
    await unsubscribeChannel(chat.chatId);
    onUpdated({ ...chat, subscriberCount: chat.subscriberCount - 1 });
  }

  return (
    <div className="dialog-overlay" data-testid="channel-info-dialog">
      <div className="dialog channel-info-dialog" ref={ref}>
        <div className="dialog-header">
          <h3>Информация о канале</h3>
          <button type="button" className="dialog-close" onClick={onClose} data-testid="channel-info-close">
            &times;
          </button>
        </div>
        <div className="dialog-body">
          <div className="channel-info-avatar">
            {title ? title.charAt(0).toUpperCase() : '#'}
          </div>

          {isOwner && editing ? (
            <>
              <input
                className="channel-info-input"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Название канала"
                data-testid="channel-info-title"
              />
              <textarea
                className="channel-info-input"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Описание (необязательно)"
                rows={3}
                data-testid="channel-info-description"
              />
              <div className="channel-info-actions">
                <button type="button" className="btn btn-primary" onClick={handleSave}>
                  Сохранить
                </button>
                <button type="button" className="btn" onClick={() => setEditing(false)}>
                  Отмена
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="channel-info-title">{title || chat.username}</div>
              {chat.username && (
                <div className="channel-info-username">@{chat.username}</div>
              )}
              {description && (
                <div className="channel-info-desc">{description}</div>
              )}
              <div className="channel-info-stats">
                <span>{chat.subscriberCount} подписчиков</span>
                {chat.username ? (
                  <a
                    href={`/channel/${chat.username}/`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="channel-info-web-link"
                  >
                    t.me/{chat.username}
                  </a>
                ) : (
                  <button
                    type="button"
                    className="btn channel-invite-btn"
                    onClick={() => {
                      navigator.clipboard.writeText(
                        `${location.origin}/chat/${chat.chatId}`,
                      );
                    }}
                  >
                    Копировать инвайт-ссылку
                  </button>
                )}
              </div>
              {isOwner && (
                <button
                  type="button"
                  className="btn"
                  onClick={() => setEditing(true)}
                >
                  Редактировать
                </button>
              )}
              {!isOwner && (
                <div className="channel-info-actions">
                  {isSubscribed ? (
                    <button
                      type="button"
                      className="btn btn-danger"
                      onClick={handleUnsubscribe}
                    >
                      Отписаться
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="btn btn-primary"
                      onClick={handleSubscribe}
                    >
                      Подписаться
                    </button>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// Search channels dialog.
interface SearchChannelsDialogProps {
  onClose: () => void;
  onSelect: (chatId: string) => void;
}

export function SearchChannelsDialog({ onClose, onSelect }: SearchChannelsDialogProps): JSX.Element {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Array<{
    chatId: string;
    title: string;
    username: string;
    description: string;
    subscriberCount: number;
  }>>([]);
  const [loading, setLoading] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent): void {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    function handleKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKey);
    };
  }, [onClose]);

  useEffect(() => {
    if (query.trim().length === 0) {
      setResults([]);
      return;
    }
    const timer = setTimeout(() => {
      setLoading(true);
      searchChannels(query)
        .then((res) => setResults(res.chats))
        .catch(() => {})
        .finally(() => setLoading(false));
    }, 300);
    return () => clearTimeout(timer);
  }, [query]);

  return (
    <div className="dialog-overlay" data-testid="search-channels-dialog">
      <div className="dialog search-channels-dialog" ref={ref}>
        <div className="dialog-header">
          <h3>Найти канал</h3>
          <button type="button" className="dialog-close" onClick={onClose} data-testid="search-channels-close">
            &times;
          </button>
        </div>
        <div className="dialog-body">
          <input
            className="search-input"
            placeholder="@хэндл или название…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoFocus
          />
          {loading && <div className="search-loading">Поиск…</div>}
          <div className="search-results">
            {results.map((ch) => (
              <button
                key={ch.chatId}
                type="button"
                className="search-result-item"
                onClick={() => { onSelect(ch.chatId); onClose(); }}
              >
                <div className="search-result-avatar">
                  {ch.title ? ch.title.charAt(0).toUpperCase() : '#'}
                </div>
                <div className="search-result-info">
                  <div className="search-result-title">{ch.title || ch.username}</div>
                  {ch.username && <div className="search-result-subtitle">@{ch.username}</div>}
                  <div className="search-result-meta">{ch.subscriberCount} подписчиков</div>
                </div>
              </button>
            ))}
            {!loading && query && results.length === 0 && (
              <div className="search-empty">Каналы не найдены</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// Create channel dialog.
interface CreateChannelDialogProps {
  onClose: () => void;
  onCreated: (chat: Chat) => void;
}

export function CreateChannelDialog({ onClose, onCreated }: CreateChannelDialogProps): JSX.Element {
  const [title, setTitle] = useState('');
  const [username, setUsername] = useState('');
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent): void {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    function handleKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKey);
    };
  }, [onClose]);

  async function handleCreate(): Promise<void> {
    if (!title.trim()) {
      setError('Введите название');
      return;
    }
    if (!username.trim()) {
      setError('Введите хэндл канала');
      return;
    }
    if (!/^[a-zA-Z0-9_]{5,32}$/.test(username)) {
      setError('Хэндл: 5-32 символов, только a-z, 0-9, _');
      return;
    }
    setCreating(true);
    setError('');
    try {
      const chat = await createChannel(title.trim(), username.trim());
      onCreated(chat);
      onClose();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('409')) setError('Этот хэндл уже занят');
      else setError('Ошибка создания канала');
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="dialog-overlay" data-testid="create-channel-dialog">
      <div className="dialog create-channel-dialog" ref={ref}>
        <div className="dialog-header">
          <h3>Новый канал</h3>
          <button type="button" className="dialog-close" onClick={onClose} data-testid="create-channel-close">
            &times;
          </button>
        </div>
        <div className="dialog-body">
          <input
            className="channel-info-input"
            placeholder="Название канала"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            autoFocus
            data-testid="channel-create-title"
          />
          <input
            className="channel-info-input"
            placeholder="@хэндл (латиница, 5-32 символов)"
            value={username}
            onChange={(e) => setUsername(e.target.value.replace(/[^a-zA-Z0-9_]/g, ''))}
            data-testid="channel-create-handle"
          />
          {error && <div className="channel-info-error">{error}</div>}
          <div className="channel-info-actions">
            <button
              type="button"
              className="btn btn-primary"
              onClick={handleCreate}
              disabled={creating}
              data-testid="channel-create-submit"
            >
              {creating ? 'Создание…' : 'Создать канал'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
