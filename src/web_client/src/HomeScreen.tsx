import { useEffect, useRef, useState } from 'react';
import {
  createDirect,
  createGroup,
  getChat,
  getChats,
  getMe,
  getPresence,
} from './api/rest';
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
  // Онлайн со-участников (множество userId). Сид — GET /presence после реплея,
  // дальше актуализируется транзиентными событиями presence из WS.
  const [onlineUsers, setOnlineUsers] = useState<Set<string>>(new Set());
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
      // Появился новый со-участник, возможно уже онлайн: presence-событий о нём
      // не будет (статус не менялся) — пересеиваем снимок онлайна.
      void getPresence()
        .then((p) => alive && setOnlineUsers(new Set(p.online)))
        .catch(() => undefined);
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

    // Собеседник прочитал — двигаем peerReadUpTo в объекте чата вперёд, даже если
    // чат сейчас закрыт. Тогда при открытии Conversation сидит верный статус ✓✓.
    const offReadMarker = ws.on('message.read', (ev: ServerEvent) => {
      const p = ev.payload as { userId: string; upToMessageId: string };
      const chatId = ev.chatId;
      if (!chatId || p.userId === myId) return;
      setChats((prev) =>
        prev.map((c) =>
          c.chatId === chatId
            ? {
                ...c,
                peerReadUpTo: String(
                  Math.max(Number(c.peerReadUpTo), Number(p.upToMessageId)),
                ),
              }
            : c,
        ),
      );
    });

    // После окончания реплея (synced) берём снимок онлайна; покрывает и
    // переподключения — на каждом synced пересеиваем множество.
    const offSynced = ws.on('synced', () => {
      void getPresence()
        .then((p) => alive && setOnlineUsers(new Set(p.online)))
        .catch(() => undefined);
    });

    // Живая смена статуса со-участника.
    const offPresence = ws.on('presence', (ev: ServerEvent) => {
      const p = ev.payload as { userId: string; online: boolean };
      setOnlineUsers((prev) => {
        const next = new Set(prev);
        if (p.online) next.add(p.userId);
        else next.delete(p.userId);
        return next;
      });
    });

    // Участника удалили из чата. Если удалили меня — убираем чат из списка и
    // снимаем выбор. Иначе — обновляем участников чата из REST.
    const offRemoved = ws.on('chat.member_removed', (ev: ServerEvent) => {
      const p = ev.payload as { chatId: string; userId: string };
      const chatId = p.chatId ?? ev.chatId;
      if (!chatId) return;
      if (p.userId === myId) {
        setChats((prev) => prev.filter((c) => c.chatId !== chatId));
        if (selectedRef.current === chatId) setSelectedId(null);
        return;
      }
      void getChat(chatId)
        .then((chat) =>
          setChats((prev) =>
            prev.map((c) => (c.chatId === chat.chatId ? chat : c)),
          ),
        )
        .catch(() => undefined);
    });

    return () => {
      alive = false;
      offCreated();
      offNew();
      offEdited();
      offDeleted();
      offReadMarker();
      offSynced();
      offPresence();
      offRemoved();
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
            onlineUsers={onlineUsers}
            onBack={() => setSelectedId(null)}
          />
        ) : (
          <div className="conversation-empty">Выберите чат</div>
        )}
      </main>
    </div>
  );
}
