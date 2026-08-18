import { useEffect, useState } from 'react';
import {
  updateChat,
  subscribeChannel,
  unsubscribeChannel,
  searchChannels,
} from '../api/rest';
import type { Chat } from '../api/types';
import { IconX } from '../util/icons';

// Channel info dialog — shown when clicking channel header.
interface ChannelInfoDialogProps {
  chat: Chat;
  myId: string | null;
  onClose: () => void;
  onUpdated: (chat: Chat) => void;
  onRemoved: (chatId: string) => void;
}

export function ChannelInfoDialog({ chat, myId, onClose, onUpdated, onRemoved }: ChannelInfoDialogProps): JSX.Element {
  const [title, setTitle] = useState(chat.title ?? '');
  const [description, setDescription] = useState(chat.description ?? '');
  const [editing, setEditing] = useState(false);
  const [copied, setCopied] = useState(false);

  const isOwner = chat.createdBy === myId;
  const isSubscribed = chat.participants.some((p) => p.userId === myId);

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
    onRemoved(chat.chatId);
  }

  return (
    <div
      className="members-backdrop"
      data-testid="channel-info-dialog"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="profile-dialog">
        <div className="profile-head">
          <span className="profile-title">Информация о канале</span>
          <button type="button" className="members-close" onClick={onClose} data-testid="channel-info-close" aria-label="Закрыть">
            <IconX />
          </button>
        </div>
        <div className="profile-body">
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
              <div className="channel-info-link">
                <input
                  className="channel-info-link-input"
                  readOnly
                  value={chat.username
                    ? `${location.origin}/channel/${chat.username}/`
                    : `${location.origin}/channel/${chat.chatId}/`
                  }
                />
                <button
                  type="button"
                  className="btn"
                  onClick={() => {
                    const url = chat.username
                      ? `${location.origin}/channel/${chat.username}/`
                      : `${location.origin}/channel/${chat.chatId}/`;
                    navigator.clipboard.writeText(url);
                    setCopied(true);
                    setTimeout(() => setCopied(false), 2000);
                  }}
                >
                  {copied ? 'Скопировано' : 'Копировать'}
                </button>
              </div>
              <div className="channel-info-stats">
                <span>{chat.subscriberCount} подписчиков</span>
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
    <div
      className="members-backdrop"
      data-testid="search-channels-dialog"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="profile-dialog">
        <div className="profile-head">
          <span className="profile-title">Найти канал</span>
          <button type="button" className="members-close" onClick={onClose} data-testid="search-channels-close" aria-label="Закрыть">
            <IconX />
          </button>
        </div>
        <div className="profile-body">
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
