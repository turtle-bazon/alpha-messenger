import { useMemo, useState } from 'react';
import type { Chat, Participant } from '../api/types';
import { decodeContent, previewText } from '../util/content';
import { renderMarkdown } from '../util/markdown';
import { formatListTime } from '../util/time';
import { IconSearch } from '../util/icons';
import { chatTitle } from './chatTitle';
import { colorFor, initialFor } from './avatar';
import { AvatarBadges } from './AvatarBadges';
import { NewChatDialog } from './NewChatDialog';

// Левая колонка (раскладка Telegram): заголовок с кнопкой «новый чат» (синяя «+»,
// открывает модалку выбора чат/группа) + список чатов.
// Состоянием списка владеет HomeScreen — сюда оно приходит готовым.
export function ChatList({
  chats,
  loading,
  selectedId,
  myId,
  onlineUsers,
  awayUsers,
  typingByChat,
  onSelect,
  onCreateDirect,
  onCreateGroup,
  onFocusInput,
}: {
  chats: Chat[];
  loading: boolean;
  selectedId: string | null;
  myId: string | null;
  onlineUsers: Set<string>;
  awayUsers: Set<string>;
  typingByChat: Map<string, Map<string, string>>;
  onSelect: (chatId: string) => void;
  onCreateDirect: (username: string) => Promise<void>;
  onCreateGroup: (title: string, members: string[]) => Promise<void>;
  onFocusInput: () => void;
}): JSX.Element {
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
    <aside
      className="chat-list"
      data-testid="chat-list"
      onClick={(e) => {
        // Фокус на поле ввода при клике в пустое место (задача #40).
        const tag = (e.target as HTMLElement).tagName;
        if (tag !== 'BUTTON' && tag !== 'INPUT') onFocusInput();
      }}
    >
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
            // Присутствие показываем только в личных чатах (для группы кружок не
            // нужен). Тайпинг — в любом чате: для direct это собеседник, для
            // группы — любой печатающий участник (#27).
            const other =
              chat.type === 'direct'
                ? chat.participants.find((p) => p.userId !== myId)
                : undefined;
            const online = other ? onlineUsers.has(other.userId) : undefined;
            const away = other && awayUsers.has(other.userId);
            const typing = (typingByChat.get(chat.chatId)?.size ?? 0) > 0;
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
                  <AvatarBadges online={online} away={away} typing={typing} />
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
                  <span
                    className="chat-item-preview"
                    data-testid="chat-item-preview"
                  >
                    {chat.lastMessage
                      ? (() => {
                          const text = previewText(decodeContent(chat.lastMessage.ciphertext));
                          const usernames = new Set(chat.participants.map((p) => p.username));
                          return renderMarkdown(text, usernames);
                        })()
                      : 'Нет сообщений'}
                  </span>
                  {chat.unreadCount > 0 && (
                    <span className="chat-item-unread" data-testid="chat-unread">
                      {chat.unreadCount}
                    </span>
                  )}
                  {chat.unreadMentions > 0 && (
                    <span className="chat-item-mention" data-testid="chat-mention">
                      @{chat.unreadMentions}
                    </span>
                  )}
                </span>
              </button>
            );
          })
        )}
      </div>
      <button
        type="button"
        className="chat-fab"
        data-testid="new-chat-button"
        aria-label="Новый чат"
        title="Новый чат"
        onClick={() => setComposing(true)}
      >
        +
      </button>
    </aside>
  );
}
