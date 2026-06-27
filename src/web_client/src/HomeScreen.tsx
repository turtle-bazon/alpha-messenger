import { useEffect, useRef, useState } from 'react';
import {
  createDirect,
  createGroup,
  getChat,
  getChats,
  getMe,
  getPresence,
} from './api/rest';
import { getLastSeq, getToken, getUserId, setLastSeq } from './api/session';
import { WsClient } from './api/ws';
import type { Chat, ServerEvent } from './api/types';
import { AccountNotifications } from './account/AccountNotifications';
import { NotificationSettings } from './notifications/NotificationSettings';
import { ChatList } from './chats/ChatList';
import { Conversation } from './chats/Conversation';
import { chatTitle } from './chats/chatTitle';
import { getTheme, setTheme, type Theme } from './util/theme';
import {
  getPermission,
  hasNotifPref,
  initNotifDefaults,
  notifyIncoming,
  requestPermission,
  setNotifBrowser,
  setUnreadBadge,
} from './util/notifications';
import { IconMoon, IconSun } from './util/icons';

// Главный экран: владеет списком чатов, WS-соединением и выбором чата.
// Живые события (chat.created, message.new) обновляют список здесь — из одного
// источника видны и список, и открытая переписка.
export function HomeScreen({
  onLogout,
}: {
  onLogout: () => void;
}): JSX.Element {
  const myId = getUserId();
  // Курсор потока seed-ится из localStorage (resume между сессиями) и сохраняется
  // при каждом продвижении — после reload реплеится только пропущенное, история не
  // принимается за live повторно (известная проблема №8).
  const [ws] = useState(
    () => new WsClient(getToken() ?? '', getLastSeq(), setLastSeq),
  );
  const [username, setUsername] = useState<string | null>(null);
  const [chats, setChats] = useState<Chat[]>([]);
  const [loading, setLoading] = useState(true);
  const [onlineUsers, setOnlineUsers] = useState<Set<string>>(new Set());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [theme, setThemeState] = useState<Theme>(getTheme);
  const selectedRef = useRef<string | null>(null);
  // Баннер запроса разрешения на уведомления: показываем только при первом входе
  // (ключей нет в localStorage) и если разрешение ещё не выдано/заблокировано.
  const [showNotifBanner, setShowNotifBanner] = useState(false);
  selectedRef.current = selectedId;
  // Актуальный список для проверок внутри WS-обработчиков (без перезапуска
  // эффекта и без побочных эффектов в setState-апдейтерах).
  const chatsRef = useRef<Chat[]>([]);
  chatsRef.current = chats;

  function toggleTheme(): void {
    const next: Theme = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    setThemeState(next);
  }

  useEffect(() => {
    getMe()
      .then((me) => setUsername(me.username))
      .catch(() => undefined);
    // Проверяем наличие ключа ДО инициализации дефолтов — initNotifDefaults()
    // создаст ключ, и hasNotifPref() вернёт true.
    const firstLogin = !hasNotifPref();
    // Явно фиксируем дефолты уведомлений в localStorage (известная проблема
    // №29) — чтобы хранилище и UI не расходились.
    initNotifDefaults();
    // При первом входе (ключей не было) и если разрешение ещё не запрашивалось —
    // показываем баннер. Запрос разрешения произойдёт при клике (user gesture),
    // иначе браузер молча игнорирует Notification.requestPermission().
    if (firstLogin && getPermission() === 'default') {
      setShowNotifBanner(true);
    }
  }, []);

  // Счётчик непрочитанных в title вкладки (известная проблема №8): сумма по всем
  // чатам. Сбрасываем title при размонтировании (логаут).
  useEffect(() => {
    const total = chats.reduce((sum, c) => sum + c.unreadCount, 0);
    setUnreadBadge(total);
  }, [chats]);
  useEffect(() => () => setUnreadBadge(0), []);

  // Подъём списка чатов + WS-соединение на время сессии.
  useEffect(() => {
    let alive = true;
    getChats()
      .then((list) => alive && setChats(list))
      .catch(() => undefined)
      .finally(() => {
        if (!alive) return;
        setLoading(false);
        // Коннектимся к WS только после загрузки списка из REST. Тогда реплей
        // ложится на уже готовый список (без дозапросов getChat на каждый чат),
        // а WsClient применяет его одним пакетом — список не «мигает» на логине.
        ws.connect();
      });

    // Новый чат создан (payload несёт только chatId) — подтягиваем объект чата.
    const offCreated = ws.on('chat.created', (ev: ServerEvent) => {
      const chatId = (ev.payload as { chatId?: string }).chatId ?? ev.chatId;
      if (!chatId) return;
      // На реплее список уже авторитетен из getChats — getChat дёргаем только для
      // реально отсутствующего чата (новый чат, созданный пока мы были офлайн).
      if (!chatsRef.current.some((c) => c.chatId === chatId)) {
        void getChat(chatId)
          .then((chat) =>
            setChats((prev) =>
              prev.some((c) => c.chatId === chat.chatId)
                ? prev
                : [chat, ...prev],
            ),
          )
          .catch(() => undefined);
      }
      // Presence: на реплее единый снимок переснимет обработчик 'synced' — здесь
      // только для живого события (новый со-участник может быть уже онлайн).
      if (ws.isLive()) {
        void getPresence()
          .then((p) => alive && setOnlineUsers(new Set(p.online)))
          .catch(() => undefined);
      }
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
      // Живость фиксируем в МОМЕНТ приёма события, а не внутри отложенного
      // setChats-апдейтера: к моменту его выполнения мог прийти 'synced' и
      // ws.isLive() стало бы true — тогда реплей считался бы за live и накручивал
      // непрочитанное (двойной счёт на холодном старте/переподключении).
      const live = ws.isLive();
      // Уведомление о входящем (известная проблема №8): только живое чужое
      // сообщение; звук/попап сработают, лишь если вкладка не активна (решает
      // notifyIncoming). Имя чата берём из актуального списка (chatsRef).
      if (live && p.senderId !== myId) {
        const chat = chatsRef.current.find((c) => c.chatId === chatId);
        notifyIncoming({
          title: chat ? chatTitle(chat, myId) : 'Новое сообщение',
          ciphertext: p.ciphertext,
          onOpen: () => setSelectedId(chatId),
        });
      }
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
          chatId === selectedRef.current || p.senderId === myId || !live;
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

    // Участника добавили в чат (приходит уже состоящим участникам) — обновляем
    // объект чата из REST, чтобы в заголовке поехал счётчик участников. Новый
    // со-участник может быть онлайн — пересеиваем снимок присутствия.
    const offAdded = ws.on('chat.member_added', (ev: ServerEvent) => {
      const p = ev.payload as { chatId: string; userId: string };
      const chatId = p.chatId ?? ev.chatId;
      if (!chatId) return;
      // На реплее состав и presence уже актуальны из getChats + снимка 'synced' —
      // не дёргаем REST повторно; реагируем только на живое добавление.
      if (!ws.isLive()) return;
      void getChat(chatId)
        .then((chat) =>
          setChats((prev) =>
            prev.map((c) => (c.chatId === chat.chatId ? chat : c)),
          ),
        )
        .catch(() => undefined);
      void getPresence()
        .then((pr) => alive && setOnlineUsers(new Set(pr.online)))
        .catch(() => undefined);
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
      // На реплее состав чата уже актуален из getChats — обновляем только вживую.
      if (!ws.isLive()) return;
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
      offAdded();
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

  async function handleNotifAllow(): Promise<void> {
    const result = await requestPermission();
    setNotifBrowser(result === 'granted');
    setShowNotifBanner(false);
  }

  function handleNotifSkip(): void {
    setNotifBrowser(false);
    setShowNotifBanner(false);
  }

  return (
    <div
      className={'home' + (selectedId ? ' home--chat-open' : '')}
      data-testid="app-home"
    >
      <AccountNotifications ws={ws} />
      {showNotifBanner && (
        <div className="notif-banner" data-testid="notif-banner">
          <span>Разрешить уведомления?</span>
          <span className="notif-banner-actions">
            <button
              type="button"
              data-testid="notif-banner-allow"
              onClick={() => void handleNotifAllow()}
            >
              Разрешить
            </button>
            <button
              type="button"
              data-testid="notif-banner-skip"
              onClick={handleNotifSkip}
            >
              Нет
            </button>
          </span>
        </div>
      )}
      <div className="sidebar">
        <header className="home-header">
          <span data-testid="home-username">{username ?? '...'}</span>
          <span className="home-header-actions">
            <NotificationSettings />
            <button
              type="button"
              className="icon-button"
              data-testid="theme-toggle"
              aria-label={
                theme === 'dark' ? 'Светлая тема' : 'Тёмная тема'
              }
              title={theme === 'dark' ? 'Светлая тема' : 'Тёмная тема'}
              onClick={toggleTheme}
            >
              {theme === 'dark' ? <IconSun /> : <IconMoon />}
            </button>
            <button type="button" onClick={onLogout}>
              Выйти
            </button>
          </span>
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
            key={selectedChat.chatId}
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
