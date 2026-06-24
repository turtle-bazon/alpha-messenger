import { useEffect, useRef, useState } from 'react';
import { createDirect, createGroup, getChat, getChats, getMe } from './api/rest';
import { getToken, getUserId } from './api/session';
import { WsClient } from './api/ws';
import type { Chat, ServerEvent } from './api/types';
import { AccountNotifications } from './account/AccountNotifications';
import { ChatList } from './chats/ChatList';
import { Conversation } from './chats/Conversation';

// Главный экран: владеет списком чатов, WS-соединением и выбором чата.
// Живые события (chat.created, message.new) обновляют список здесь — из одного
// источника видны и список, и открытая переписка.
export function HomeScreen({
  onLogout,
}: {
  onLogout: () => void;
}): JSX.Element {
  const myId = getUserId();
  const [ws] = useState(() => new WsClient(getToken() ?? '', 0));
  const [username, setUsername] = useState<string | null>(null);
  const [chats, setChats] = useState<Chat[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selectedRef = useRef<string | null>(null);
  selectedRef.current = selectedId;

  useEffect(() => {
    getMe()
      .then((me) => setUsername(me.username))
      .catch(() => undefined);
  }, []);

  // Подъём списка чатов + WS-соединение на время сессии.
  useEffect(() => {
    let alive = true;
    getChats()
      .then((list) => alive && setChats(list))
      .catch(() => undefined)
      .finally(() => alive && setLoading(false));

    ws.connect();

    // Новый чат создан (payload несёт только chatId) — подтягиваем объект чата.
    const offCreated = ws.on('chat.created', (ev: ServerEvent) => {
      const chatId = (ev.payload as { chatId?: string }).chatId ?? ev.chatId;
      if (!chatId) return;
      void getChat(chatId).then((chat) =>
        setChats((prev) =>
          prev.some((c) => c.chatId === chat.chatId)
            ? prev
            : [chat, ...prev],
        ),
      );
    });

    // Новое сообщение — обновляем превью/порядок/непрочитанные в списке.
    const offNew = ws.on('message.new', (ev: ServerEvent) => {
      const p = ev.payload as {
        messageId: string;
        senderId: string;
        ciphertext: string;
        ts: string;
      };
      const chatId = ev.chatId;
      if (!chatId) return;
      setChats((prev) => {
        const idx = prev.findIndex((c) => c.chatId === chatId);
        if (idx < 0) {
          void getChat(chatId).then((chat) =>
            setChats((cur) =>
              cur.some((c) => c.chatId === chat.chatId)
                ? cur
                : [chat, ...cur],
            ),
          );
          return prev;
        }
        const chat = prev[idx];
        // Во время реплея истории счётчик непрочитанного авторитетен из
        // GET /chats — не накручиваем его повторно, обновляем лишь превью/порядок.
        const keepUnread =
          chatId === selectedRef.current || p.senderId === myId || !ws.isLive();
        const updated: Chat = {
          ...chat,
          lastMessage: {
            messageId: p.messageId,
            senderId: p.senderId,
            ciphertext: p.ciphertext,
            ts: p.ts,
          },
          updatedAt: p.ts,
          unreadCount: keepUnread ? chat.unreadCount : chat.unreadCount + 1,
        };
        return [updated, ...prev.filter((c) => c.chatId !== chatId)];
      });
    });

    // Превью списка отражает правку/удаление последнего сообщения.
    const offEdited = ws.on('message.edited', (ev: ServerEvent) => {
      const p = ev.payload as { messageId: string; ciphertext: string };
      setChats((prev) =>
        prev.map((c) =>
          c.lastMessage && c.lastMessage.messageId === p.messageId
            ? { ...c, lastMessage: { ...c.lastMessage, ciphertext: p.ciphertext } }
            : c,
        ),
      );
    });
    const offDeleted = ws.on('message.deleted', (ev: ServerEvent) => {
      const p = ev.payload as { messageId: string };
      setChats((prev) =>
        prev.map((c) =>
          c.lastMessage && c.lastMessage.messageId === p.messageId
            ? { ...c, lastMessage: { ...c.lastMessage, ciphertext: '' } }
            : c,
        ),
      );
    });

    return () => {
      alive = false;
      offCreated();
      offNew();
      offEdited();
      offDeleted();
      ws.close();
    };
  }, [ws]);

  async function onCreateDirect(target: string): Promise<void> {
    const chat = await createDirect(target);
    setChats((prev) => [chat, ...prev.filter((c) => c.chatId !== chat.chatId)]);
    setSelectedId(chat.chatId);
  }

  async function onCreateGroup(title: string, members: string[]): Promise<void> {
    const chat = await createGroup(title, members);
    setChats((prev) => [chat, ...prev.filter((c) => c.chatId !== chat.chatId)]);
    setSelectedId(chat.chatId);
  }

  function onSelect(chatId: string): void {
    setSelectedId(chatId);
    // сбросить локальный счётчик непрочитанных при открытии (отметка read — п.16)
    setChats((prev) =>
      prev.map((c) =>
        c.chatId === chatId ? { ...c, unreadCount: 0 } : c,
      ),
    );
  }

  const selectedChat = chats.find((c) => c.chatId === selectedId) ?? null;

  return (
    <div
      className={'home' + (selectedId ? ' home--chat-open' : '')}
      data-testid="app-home"
    >
      <AccountNotifications ws={ws} />
      <div className="sidebar">
        <header className="home-header">
          <span data-testid="home-username">{username ?? '...'}</span>
          <button type="button" onClick={onLogout}>
            Выйти
          </button>
        </header>
        <ChatList
          chats={chats}
          loading={loading}
          selectedId={selectedId}
          onSelect={onSelect}
          onCreateDirect={onCreateDirect}
          onCreateGroup={onCreateGroup}
        />
      </div>
      <main className="conversation">
        {selectedChat ? (
          <Conversation
            chat={selectedChat}
            ws={ws}
            myId={myId}
            onBack={() => setSelectedId(null)}
          />
        ) : (
          <div className="conversation-empty">Выберите чат</div>
        )}
      </main>
    </div>
  );
}
