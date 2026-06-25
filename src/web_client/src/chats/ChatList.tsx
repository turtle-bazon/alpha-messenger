import { useMemo, useState } from 'react';
import { getUserId } from '../api/session';
import type { Chat, Participant } from '../api/types';
import { decodeContent, previewText } from '../util/content';
import { formatListTime } from '../util/time';
import { IconSearch } from '../util/icons';
import { chatTitle } from './chatTitle';
import { colorFor, initialFor } from './avatar';
import { NewChatDialog } from './NewChatDialog';

// Левая колонка (раскладка Telegram): заголовок с кнопкой «новый чат» (синяя «+»,
// открывает модалку выбора чат/группа) + список чатов.
// Состоянием списка владеет HomeScreen — сюда оно приходит готовым.
export function ChatList({
  chats,
  loading,
  selectedId,
  onSelect,
  onCreateDirect,
  onCreateGroup,
}: {
  chats: Chat[];
  loading: boolean;
  selectedId: string | null;
  onSelect: (chatId: string) => void;
  onCreateDirect: (username: string) => Promise<void>;
  onCreateGroup: (title: string, members: string[]) => Promise<void>;
}): JSX.Element {
  const myId = getUserId();
  const [composing, setComposing] = useState(false);
  const [query, setQuery] = useState('');

  // Фильтрация списка по названию чата (как поиск в Telegram, локально).
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return chats;
    return chats.filter((c) => chatTitle(c, myId).toLowerCase().includes(q));
  }, [chats, query, myId]);

  // Кандидаты в участники группы — собеседники из существующих личных чатов
  // (с кем уже есть переписка). Себя исключаем: создатель входит в группу
  // автоматически на сервере (известная проблема №4). Уникальны по userId.
  const knownUsers = useMemo<Participant[]>(() => {
    const map = new Map<string, string>();
    for (const c of chats) {
      if (c.type !== 'direct') continue;
      for (const p of c.participants) {
        if (p.userId !== myId) map.set(p.userId, p.username);
      }
    }
    return [...map.entries()].map(([userId, username]) => ({
      userId,
      username,
    }));
  }, [chats, myId]);

  return (
    <aside className="chat-list" data-testid="chat-list">
      <div className="chat-list-bar">
        <span className="chat-list-bar-title">Чаты</span>
        <button
          type="button"
          className="chat-list-compose"
          data-testid="new-chat-button"
          aria-label="Новый чат"
          title="Новый чат"
          onClick={() => setComposing(true)}
        >
          +
        </button>
      </div>
      <div className="chat-search">
        <span className="chat-search-icon" aria-hidden="true">
          <IconSearch />
        </span>
        <input
          className="chat-search-input"
          type="search"
          data-testid="chat-search"
          aria-label="Поиск чатов"
          placeholder="Поиск"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      {composing && (
        <NewChatDialog
          knownUsers={knownUsers}
          onCreateDirect={onCreateDirect}
          onCreateGroup={onCreateGroup}
          onClose={() => setComposing(false)}
        />
      )}
      <div className="chat-list-items">
        {loading ? (
          <p className="chat-list-empty">Загрузка…</p>
        ) : chats.length === 0 ? (
          <p className="chat-list-empty">Чатов пока нет</p>
        ) : filtered.length === 0 ? (
          <p className="chat-list-empty">Ничего не найдено</p>
        ) : (
          filtered.map((chat) => {
            const title = chatTitle(chat, myId);
            return (
              <button
                key={chat.chatId}
                type="button"
                data-testid="chat-item"
                className={
                  'chat-item' +
                  (chat.chatId === selectedId ? ' is-selected' : '')
                }
                onClick={() => onSelect(chat.chatId)}
              >
                <span
                  className="chat-avatar"
                  style={{ background: colorFor(title) }}
                  aria-hidden="true"
                >
                  {initialFor(title)}
                </span>
                <span className="chat-item-row chat-item-top">
                  <span className="chat-item-title">{title}</span>
                  {chat.lastMessage && (
                    <span className="chat-item-time">
                      {formatListTime(chat.lastMessage.ts)}
                    </span>
                  )}
                </span>
                <span className="chat-item-row chat-item-bottom">
                  <span className="chat-item-preview">
                    {chat.lastMessage
                      ? previewText(decodeContent(chat.lastMessage.ciphertext))
                      : 'Нет сообщений'}
                  </span>
                  {chat.unreadCount > 0 && (
                    <span className="chat-item-unread" data-testid="chat-unread">
                      {chat.unreadCount}
                    </span>
                  )}
                </span>
              </button>
            );
          })
        )}
      </div>
    </aside>
  );
}
