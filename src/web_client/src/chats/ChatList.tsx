import { useState } from 'react';
import { getUserId } from '../api/session';
import type { Chat } from '../api/types';
import { decodeContent, previewText } from '../util/content';
import { formatListTime } from '../util/time';
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
      {composing && (
        <NewChatDialog
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
        ) : (
          chats.map((chat) => {
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
