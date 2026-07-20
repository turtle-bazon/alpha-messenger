import { useEffect, useRef, useState } from 'react';
import {
  createDirect,
  createGroup,
  getChat,
  getChats,
  getMe,
  getPresence,
  reportActivity,
} from './api/rest';
import { getLastSeq, getToken, getUserId, setLastSeq } from './api/session';
import { WsClient } from './api/ws';
import type { Chat, MessagePreview, ServerEvent } from './api/types';
import { AccountNotifications } from './account/AccountNotifications';
import { ChatList } from './chats/ChatList';
import { Conversation } from './chats/Conversation';
import { AboutDialog } from './chats/AboutDialog';
import { SettingsScreen } from './SettingsScreen';
import { useTyping } from './chats/useTyping';
import { chatTitle } from './chats/chatTitle';
import { getTheme, setTheme, type Theme } from './util/theme';
import {
  getNotifPrefs,
  getPermission,
  initNotifDefaults,
  notifyIncoming,
  notifyReaction,
  requestPermission,
  setNotifBrowser,
  setUnreadBadge,
} from './util/notifications';

// Самое свежее превью из набора кандидатов (по возрастанию message_id). Нужно,
// чтобы превью в списке не «застревало» на раннем сообщении при гонке нескольких
// параллельных getChat (см. задачу #28, ветка idx<0 ниже).
function newestPreview(
  ...candidates: (MessagePreview | null | undefined)[]
): MessagePreview | null {
  let best: MessagePreview | null = null;
  for (const c of candidates) {
    if (!c) continue;
    if (!best || Number(c.messageId) > Number(best.messageId)) best = c;
  }
  return best;
}

// Стабильная пустая ссылка для чатов без печатающих — чтобы не плодить новые
// Map на каждый рендер (лишние ререндеры Conversation).
const EMPTY_TYPING: Map<string, string> = new Map();

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
  const [awayUsers, setAwayUsers] = useState<Set<string>>(new Set());
  // Кто печатает, по чатам — единый источник для списка чатов, заголовка
  // переписки и окна участников (задача #27).
  const typingByChat = useTyping(ws, myId);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [theme, setThemeState] = useState<Theme>(getTheme);
  const selectedRef = useRef<string | null>(null);
  // Баннер запроса разрешения на уведомления: показываем только при первом входе
  // (ключей нет в localStorage) и если разрешение ещё не выдано/заблокировано.
  const [showNotifBanner, setShowNotifBanner] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  selectedRef.current = selectedId;
  // Актуальный список для проверок внутри WS-обработчиков (без перезапуска
  // эффекта и без побочных эффектов в setState-апдейтерах).
  const chatsRef = useRef<Chat[]>([]);
  chatsRef.current = chats;
  // Ссылка на поле ввода сообщений — для глобального фокуса (задача #40).
  const inputRef = useRef<HTMLDivElement>(null);

  function toggleTheme(): void {
    const next: Theme = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    setThemeState(next);
  }

  useEffect(() => {
    getMe()
      .then((me) => setUsername(me.username))
      .catch(() => undefined);
    // Явно фиксируем дефолты уведомлений в localStorage (известная проблема
    // №29) — чтобы хранилище и UI не расходились.
    initNotifDefaults();
    // Если настройка браузерных уведомлений включена (дефолт '1' или пользователь
    // включил), но системное разрешение ещё не запрошено (permission = 'default') —
    // показываем баннер. Запрос произойдёт при клике (user gesture), иначе
    // браузер молча игнорирует Notification.requestPermission().
    if (getNotifPrefs().browser && getPermission() === 'default') {
      setShowNotifBanner(true);
    }
  }, []);

  // Глобальный фокус поля ввода при нажатии клавиши или вставке (задача #40).
  // При открытом модале (members-backdrop, new-chat-backdrop и т.п.),
  // эмодзи-пикере или пикере реакций фокус не смещаем (#47, #56, #23).
  useEffect(() => {
    const focusInput = () => inputRef.current?.focus();
    const isModalOpen = (): boolean =>
      !!document.querySelector('[class*="-backdrop"], [data-testid="emoji-picker"], [data-testid="context-menu"]');
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (['Tab', 'Shift', 'Control', 'Alt', 'Meta', 'Escape'].includes(e.key)) return;
      if (isModalOpen()) return;
      // Если фокус уже на input/textarea — не перехватываем
      const active = document.activeElement;
      if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA')) return;
      focusInput();
    };
    const onPaste = () => { if (!isModalOpen()) focusInput(); };
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('paste', onPaste);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('paste', onPaste);
    };
  }, []);

  // Счётчик непрочитанных в title вкладки (известная проблема №8): сумма по всем
  // чатам. Сбрасываем title при размонтировании (логаут).
  useEffect(() => {
    const total = chats.reduce((sum, c) => sum + c.unreadCount, 0);
    setUnreadBadge(total);
    // Badge на иконке в трее (Electron desktop)
    window.electronAPI?.setBadgeCount(total);
  }, [chats]);
  useEffect(() => () => setUnreadBadge(0), []);

  // Периодическая проверка версии клиента. Если на сервере новая сборка —
  // перезагружаем страницу (обновление без Ctrl+Shift+R).
  // На Android/ desktop bundled-клиенте проверяем version.json на сервере напрямую.
  useEffect(() => {
    let currentVersion: string | null = null;
    const savedServerUrl = localStorage.getItem('alpha.serverUrl');
    const isBundled = window.location.protocol === 'file:'
      || (savedServerUrl && window.location.origin === 'https://localhost');
    const serverUrl = isBundled ? savedServerUrl : null;
    const versionUrl = serverUrl ? `${serverUrl}/version.json` : '/version.json';
    const reloadUrl = serverUrl || undefined;

    fetch(versionUrl)
      .then((r) => r.json())
      .then((v) => { currentVersion = v.version; })
      .catch(() => {});

    const CHECK_MS = 5 * 60 * 1000;
    const interval = setInterval(() => {
      fetch(versionUrl)
        .then((r) => r.json())
        .then((v) => {
          if (currentVersion && v.version !== currentVersion) {
            if (reloadUrl) {
              window.location.href = reloadUrl;
            } else {
              window.location.reload();
            }
          }
        })
        .catch(() => {});
    }, CHECK_MS);
    return () => clearInterval(interval);
  }, []);

  // Пинг активности каждые 30 сек (#36): чтобы сервер знал, когда пользователь "away".
  useEffect(() => {
    const THROTTLE_MS = 30_000;
    let lastPing = 0;
    const ping = () => {
      if (document.hidden) return;
      const now = Date.now();
      if (now - lastPing < THROTTLE_MS) return;
      lastPing = now;
      reportActivity().catch(() => {});
    };
    document.addEventListener('mousemove', ping);
    document.addEventListener('keydown', ping);
    document.addEventListener('focus', ping);
    return () => {
      document.removeEventListener('mousemove', ping);
      document.removeEventListener('keydown', ping);
      document.removeEventListener('focus', ping);
    };
  }, []);

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
          .then((p) => {
            if (!alive) return;
            const online = new Set<string>();
            const away = new Set<string>();
            for (const [uid, info] of Object.entries(p.presence)) {
              if (info.online) online.add(uid);
              if (info.away) away.add(uid);
            }
            setOnlineUsers(online);
            setAwayUsers(away);
          })
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
        replyToMessageId?: string;
        isReply?: boolean;
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
          isReply: p.isReply,
          onOpen: () => setSelectedId(chatId),
        });
      }
      setChats((prev) => {
        const idx = prev.findIndex((c) => c.chatId === chatId);
        if (idx < 0) {
          // Чата ещё нет в списке (новый чат / всплеск сообщений в него) —
          // тянем объект чата. Превью берём как самое свежее из загруженного
          // снимка, уже лежащего в списке и самого события: несколько message.new
          // в один новый чат запускают параллельные getChat, и «победитель» мог
          // снять устаревший снимок — без этой подстраховки превью застревало бы
          // на раннем сообщении (задача #28).
          const preview: MessagePreview = {
            messageId: p.messageId,
            senderId: p.senderId,
            ciphertext: p.ciphertext,
            ts: p.ts,
          };
          void getChat(chatId).then((chat) =>
            setChats((cur) => {
              const existing = cur.find((c) => c.chatId === chat.chatId);
              const lastMessage = newestPreview(
                chat.lastMessage,
                existing?.lastMessage,
                preview,
              );
              return existing
                ? cur.map((c) =>
                    c.chatId === chat.chatId ? { ...c, lastMessage } : c,
                  )
                : [{ ...chat, lastMessage }, ...cur];
            }),
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

    // Реакция на сообщение — уведомление (звук + browser notification).
    // Свои реакции не уведомляем; уведомление срабатывает только когда вкладка не активна.
    const offReaction = ws.on('message.reaction', (ev: ServerEvent) => {
      const p = ev.payload as {
        messageId: string;
        userId: string;
        emoji: string;
        action: 'added' | 'removed';
      };
      const chatId = ev.chatId;
      if (!chatId) return;
      if (p.userId === myId) return;
      if (p.action !== 'added') return;
      const chat = chatsRef.current.find((c) => c.chatId === chatId);
      const title = chat ? chatTitle(chat, myId) : 'Чат';
      // Ищем имя реактора среди участников чата
      const reactor = chat?.participants.find((pt) => pt.userId === p.userId);
      const reactorName = reactor?.username ?? 'Пользователь';
      notifyReaction({
        title,
        reactor: reactorName,
        emoji: p.emoji,
        onOpen: () => setSelectedId(chatId),
      });
    });

    // Собеседник прочитал — двигаем peerReadUpTo в объекте чата вперёд, даже если
    // чат сейчас закрыт. Тогда при открытии Conversation сидит верный статус ✓✓.
    // Если это наше собственное событие (другое устройство) — обнуляем unreadCount.
    const offReadMarker = ws.on('message.read', (ev: ServerEvent) => {
      const p = ev.payload as { userId: string; upToMessageId: string };
      const chatId = ev.chatId;
      if (!chatId) return;

      if (p.userId === myId) {
        // Другое устройство прочитало — синхронизируем unreadCount
        setChats((prev) =>
          prev.map((c) =>
            c.chatId === chatId ? { ...c, unreadCount: 0 } : c,
          ),
        );
        return;
      }

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
        .then((p) => {
          if (!alive) return;
          const online = new Set<string>();
          const away = new Set<string>();
          for (const [uid, info] of Object.entries(p.presence)) {
            if (info.online) online.add(uid);
            if (info.away) away.add(uid);
          }
          setOnlineUsers(online);
          setAwayUsers(away);
        })
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
        .then((pr) => {
          if (!alive) return;
          const online = new Set<string>();
          const away = new Set<string>();
          for (const [uid, info] of Object.entries(pr.presence)) {
            if (info.online) online.add(uid);
            if (info.away) away.add(uid);
          }
          setOnlineUsers(online);
          setAwayUsers(away);
        })
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
      offReaction();
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
        <div
          className="notif-overlay"
          data-testid="notif-overlay"
          onClick={handleNotifSkip}
          onKeyDown={(e) => {
            if (e.key === 'Escape') handleNotifSkip();
          }}
          role="presentation"
        >
          <div
            className="notif-modal"
            data-testid="notif-banner"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key === 'Escape') handleNotifSkip();
            }}
          >
            <div className="notif-modal-icon">🔔</div>
            <h3 className="notif-modal-title">Разрешить уведомления?</h3>
            <p className="notif-modal-text">
              Вы будете получать уведомления о новых сообщениях, даже когда
              приложение свёрнуто.
            </p>
            <div className="notif-modal-actions">
              <button
                type="button"
                className="notif-modal-btn notif-modal-btn--primary"
                data-testid="notif-banner-allow"
                onClick={() => void handleNotifAllow()}
              >
                Разрешить
              </button>
              <button
                type="button"
                className="notif-modal-btn notif-modal-btn--secondary"
                data-testid="notif-banner-skip"
                onClick={handleNotifSkip}
              >
                Не сейчас
              </button>
            </div>
          </div>
        </div>
      )}
      <div className="sidebar">
        {settingsOpen ? (
          <SettingsScreen
            username={username}
            theme={theme}
            onToggleTheme={toggleTheme}
            onLogout={onLogout}
            onAbout={() => { setSettingsOpen(false); setAboutOpen(true); }}
            onBack={() => setSettingsOpen(false)}
          />
        ) : (
          <>
            <header className="home-header">
              <button
                type="button"
                className="icon-button home-hamburger"
                data-testid="settings-btn"
                aria-label="Настройки"
                title="Настройки"
                onClick={() => setSettingsOpen(true)}
              >
                ☰
              </button>
              <span className="home-header-title" data-testid="home-username">
                {username ?? '...'}
              </span>
            </header>
            <ChatList
              chats={chats}
              loading={loading}
              selectedId={selectedId}
              myId={myId}
              onlineUsers={onlineUsers}
              awayUsers={awayUsers}
              typingByChat={typingByChat}
              onSelect={onSelect}
              onCreateDirect={onCreateDirect}
              onCreateGroup={onCreateGroup}
              onFocusInput={() => inputRef.current?.focus()}
            />
          </>
        )}
      </div>
      <main className="conversation">
        {selectedChat ? (
          <Conversation
            key={selectedChat.chatId}
            chat={selectedChat}
            ws={ws}
            myId={myId}
            onlineUsers={onlineUsers}
            awayUsers={awayUsers}
            typingUsers={typingByChat.get(selectedChat.chatId) ?? EMPTY_TYPING}
            inputRef={inputRef}
            onBack={() => setSelectedId(null)}
          />
        ) : (
          <div className="conversation-empty">Выберите чат</div>
        )}
      </main>
      {aboutOpen && <AboutDialog onClose={() => setAboutOpen(false)} />}
    </div>
  );
}
