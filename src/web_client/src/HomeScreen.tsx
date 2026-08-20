import { useEffect, useRef, useState } from 'react';
import {
  createChannel,
  createDirect,
  createGroup,
  getChat,
  getChats,
  getMe,
  getPresence,
  reportActivity,
  resolveChannelId,
} from './api/rest';
import { getLastSeq, getToken, getUserId, setLastSeq } from './api/session';
import { WsClient } from './api/ws';
import type { Chat, MessagePreview, ServerEvent } from './api/types';
import { AccountNotifications } from './account/AccountNotifications';
import { ChatList } from './chats/ChatList';
import { Conversation } from './chats/Conversation';
import { AboutDialog } from './chats/AboutDialog';
import { UserProfileDialog } from './chats/UserProfileDialog';
import { SettingsScreen } from './SettingsScreen';
import { IconMenu, IconBell } from './util/icons';
import { useTyping } from './chats/useTyping';
import { chatTitle } from './chats/chatTitle';
import { getTheme, setTheme, type Theme } from './util/theme';
import {
  ensureBrowserPermission,
  getNotifPrefs,
  getPermission,
  initNotifDefaults,
  notifyIncoming,
  notifyReaction,
  requestPermission,
  setNotifBrowser,
  setUnreadBadge,
} from './util/notifications';

// The freshest preview from a set of candidates (by ascending message_id). Keeps
// the list preview from getting stuck on an early message when several parallel
// getChat calls race (see issue #28, the idx<0 branch below).
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

// Stable empty reference for chats without typers — avoids creating new Maps
// on every render (extra Conversation re-renders).
const EMPTY_TYPING: Map<string, string> = new Map();

// Main screen: owns the chat list, the WS connection and chat selection.
// Live events (chat.created, message.new) update the list here — both the list
// and the open conversation are visible from a single source.
export function HomeScreen({
  onLogout,
}: {
  onLogout: () => void;
}): JSX.Element {
  const myId = getUserId();
  // The stream cursor is seeded from localStorage (resume across sessions) and
  // saved on each advance — after reload only missed events are replayed; history
  // is never treated as live again (known issue #8).
  const [ws] = useState(
    () => new WsClient(getToken() ?? '', getLastSeq(), setLastSeq),
  );
  const [username, setUsername] = useState<string | null>(null);
  const [chats, setChats] = useState<Chat[]>([]);
  const [loading, setLoading] = useState(true);
  const [onlineUsers, setOnlineUsers] = useState<Set<string>>(new Set());
  const [awayUsers, setAwayUsers] = useState<Set<string>>(new Set());
  // Who is typing, per chat — single source for the chat list, conversation
  // header and members dialog (issue #27).
  const typingByChat = useTyping(ws, myId);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [theme, setThemeState] = useState<Theme>(getTheme);
  const selectedRef = useRef<string | null>(null);
  // Notification permission request banner: shown only on first visit (no keys
  // in localStorage) and if permission is not yet granted/blocked.
  const [showNotifBanner, setShowNotifBanner] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [profileUserId, setProfileUserId] = useState<string | null>(null);
  selectedRef.current = selectedId;
  // Up-to-date list for checks inside WS handlers (without restarting the
  // effect and without side effects in setState updaters).
  const chatsRef = useRef<Chat[]>([]);
  chatsRef.current = chats;
  // Reference to the message input field — for global focus (issue #40).
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
    // Explicitly persist notification defaults to localStorage (known issue
    // #29) so storage and UI don't diverge.
    initNotifDefaults();
    // On Android, request POST_NOTIFICATIONS permission
    void ensureBrowserPermission();
    // If browser notifications are enabled (default '1' or enabled by the user)
    // but system permission hasn't been requested yet (permission = 'default'),
    // show the banner. The request happens on click (user gesture); otherwise
    // browsers silently ignore Notification.requestPermission().
    if (getNotifPrefs().browser && getPermission() === 'default') {
      setShowNotifBanner(true);
    }
  }, []);

  // Global focus of the input field on keypress or paste (issue #40).
  // When a modal is open (members-backdrop, new-chat-backdrop etc.), or the
  // emoji picker / reaction picker, focus is not moved (#47, #56, #23).
  useEffect(() => {
    const focusInput = () => inputRef.current?.focus();
    const isModalOpen = (): boolean =>
      !!document.querySelector('[class*="-backdrop"], [data-testid="emoji-picker"], [data-testid="context-menu"]');
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (['Tab', 'Shift', 'Control', 'Alt', 'Meta', 'Escape'].includes(e.key)) return;
      if (isModalOpen()) return;
      // If focus is already on an input/textarea — don't intercept
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

  // Unread counter in the tab title (known issue #8): sum across all chats.
  // Reset the title on unmount (logout).
  useEffect(() => {
    const total = chats.reduce((sum, c) => sum + c.unreadCount, 0);
    setUnreadBadge(total);
    // Badge on the tray icon (Electron desktop)
    window.electronAPI?.setBadgeCount(total);
  }, [chats]);
  useEffect(() => () => setUnreadBadge(0), []);

  // Periodic client version check. If the server has a newer build — reload
  // the page (update without Ctrl+Shift+R).
  // On Android / bundled desktop client, check version.json on the server directly.
  useEffect(() => {
    let currentVersion: string | null = null;
    const nativeServerUrl = ((window as any).AlphaConfig?.getServerUrl?.()
      || (window as any).__ALPHA_CONFIG__?.serverUrl) as string | undefined;
    const isBundled = window.location.protocol === 'file:' || !!nativeServerUrl;
    const serverUrl = isBundled ? (nativeServerUrl || null) : null;
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

  // Activity ping every 30 sec (#36): lets the server know when the user is "away".
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

  // Bootstrapping the chat list + WS connection for the session.
  useEffect(() => {
    let alive = true;
    getChats()
      .then((list) => alive && setChats(list))
      .catch(() => undefined)
      .finally(() => {
        if (!alive) return;
        setLoading(false);
        // Connect to WS only after the REST list has loaded. The replay then lands
        // on an already populated list (no extra getChat per chat), and WsClient
        // applies it in one batch — the list doesn't flicker on login.
        ws.connect();
      });

    // New chat created (payload carries only chatId) — fetch the chat object.
    const offCreated = ws.on('chat.created', (ev: ServerEvent) => {
      const chatId = (ev.payload as { chatId?: string }).chatId ?? ev.chatId;
      if (!chatId) return;
      // On replay the list is already authoritative from getChats — call getChat
      // only for a genuinely missing chat (created while we were offline).
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
      // Presence: on replay the 'synced' handler takes a fresh snapshot — here
      // only for the live event (a new member may already be online).
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

    // New message — update preview/order/unread counts in the list.
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
      // Capture liveness at the MOMENT the event arrives, not inside the deferred
      // setChats updater: by the time it runs, 'synced' may have arrived making
      // ws.isLive() true — then replay would count as live and inflate unread
      // counts (double counting on cold start/reconnect).
      const live = ws.isLive();
      // Incoming notification (known issue #8): only live messages from others;
      // sound/popup fire only when the tab is inactive (handled by
      // notifyIncoming). Chat name comes from the current list (chatsRef).
      if (live && p.senderId !== myId) {
        const chat = chatsRef.current.find((c) => c.chatId === chatId);
        notifyIncoming({
          title: chat ? chatTitle(chat, myId) : 'Новое сообщение',
          ciphertext: p.ciphertext,
          chatId,
          currentChatId: selectedRef.current,
          isReply: p.isReply,
          onOpen: () => setSelectedId(chatId),
        });
      }
      setChats((prev) => {
        const idx = prev.findIndex((c) => c.chatId === chatId);
        if (idx < 0) {
          // Chat not in the list yet (new chat / burst of messages into it) —
          // fetch the chat object. Take the preview as the freshest among the
          // loaded snapshot already in the list and this event: several message.new
          // into one new chat trigger parallel getChat calls, and the "winner"
          // may have taken a stale snapshot — without this safeguard the preview
          // would stick to an early message (issue #28).
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
        // During history replay the unread count is authoritative from
        // GET /chats — don't increment it again, update only preview/order.
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

    // List preview reflects edit/deletion of the last message.
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

    // Reaction to a message — notification (sound + browser notification).
    // Own reactions don't notify; the notification fires only when the tab is inactive.
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
      // Look up the reactor's name among chat participants
      const reactor = chat?.participants.find((pt) => pt.userId === p.userId);
      const reactorName = reactor?.username ?? 'Пользователь';
      notifyReaction({
        title,
        reactor: reactorName,
        emoji: p.emoji,
        onOpen: () => setSelectedId(chatId),
      });
    });

    // Peer read — advance peerReadUpTo in the chat object even if the chat is
    // currently closed, so Conversation shows the correct ✓✓ status when opened.
    // If it's our own event (another device) — reset unreadCount.
    const offReadMarker = ws.on('message.read', (ev: ServerEvent) => {
      const p = ev.payload as { userId: string; upToMessageId: string };
      const chatId = ev.chatId;
      if (!chatId) return;

      if (p.userId === myId) {
        // Another device read the messages — sync unreadCount
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

    // After the replay finishes (synced), take a snapshot of online users; also
    // covers reconnects — reseed the set on every synced.
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

    // Live status change of a member.
    const offPresence = ws.on('presence', (ev: ServerEvent) => {
      const p = ev.payload as { userId: string; online: boolean };
      setOnlineUsers((prev) => {
        const next = new Set(prev);
        if (p.online) next.add(p.userId);
        else next.delete(p.userId);
        return next;
      });
    });

    // A member was added to the chat (sent to existing members) — refresh the
    // chat object from REST so the header shows the updated member count. The
    // new member may be online — reseed the presence snapshot.
    const offAdded = ws.on('chat.member_added', (ev: ServerEvent) => {
      const p = ev.payload as { chatId: string; userId: string };
      const chatId = p.chatId ?? ev.chatId;
      if (!chatId) return;
      // On replay, membership and presence are already current from getChats +
      // the 'synced' snapshot — skip REST; react only to live additions.
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

    // A member was removed from the chat. If it was me — drop the chat from the
    // list and clear selection. Otherwise — refresh chat participants from REST.
    const offRemoved = ws.on('chat.member_removed', (ev: ServerEvent) => {
      const p = ev.payload as { chatId: string; userId: string };
      const chatId = p.chatId ?? ev.chatId;
      if (!chatId) return;
      if (p.userId === myId) {
        setChats((prev) => prev.filter((c) => c.chatId !== chatId));
        if (selectedRef.current === chatId) setSelectedId(null);
        return;
      }
      // On replay, chat membership is already current from getChats — update live only.
      if (!ws.isLive()) return;
      void getChat(chatId)
        .then((chat) =>
          setChats((prev) =>
            prev.map((c) => (c.chatId === chat.chatId ? chat : c)),
          ),
        )
        .catch(() => undefined);
    });

    // On Android: reconnect WS and sync when returning from background
    const onForeground = (): void => {
      console.log('Alpha: foreground — reconnecting WS');
      ws.reconnect();
    };
    window.addEventListener('app-foreground', onForeground);
    const offForeground = () => window.removeEventListener('app-foreground', onForeground);

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
      offForeground();
      ws.close();
    };
  }, [ws]);

  // Open a channel from URL: /channel/:id/
  useEffect(() => {
    const match = window.location.pathname.match(/^\/channel\/([^/]+)\/?$/);
    if (!match) return;
    const id = match[1];
    resolveChannelId(id)
      .then((chatId) => getChat(chatId))
      .then((chat) => {
        setChats((prev) =>
          prev.some((c) => c.chatId === chat.chatId)
            ? prev
            : [chat, ...prev],
        );
        setSelectedId(chat.chatId);
        window.history.replaceState(null, '', '/');
      })
      .catch(() => undefined);
  }, []);

  // Intercept clicks on /channel/ links inside the SPA — open the channel instead of navigating.
  useEffect(() => {
    function extractChannelId(href: string): string | null {
      // Relative: /channel/:id/
      const rel = href.match(/^\/channel\/([^/]+)\/?$/);
      if (rel) return rel[1];
      // Absolute on same origin: https://host/channel/:id/
      try {
        const url = new URL(href, window.location.origin);
        if (url.origin === window.location.origin) {
          const abs = url.pathname.match(/^\/channel\/([^/]+)\/?$/);
          if (abs) return abs[1];
        }
      } catch { /* not a URL */ }
      return null;
    }
    function openChannel(id: string): void {
      resolveChannelId(id)
        .then((chatId) => getChat(chatId))
        .then((chat) => {
          setChats((prev) =>
            prev.some((c) => c.chatId === chat.chatId)
              ? prev
              : [chat, ...prev],
          );
          setSelectedId(chat.chatId);
        })
        .catch(() => undefined);
    }
    function onClick(e: MouseEvent): void {
      const a = (e.target as HTMLElement).closest('a[href]');
      if (!a) return;
      const id = extractChannelId(a.getAttribute('href') ?? '');
      if (!id) return;
      e.preventDefault();
      openChannel(id);
    }
    function onChannelLink(e: Event): void {
      const href = (e as CustomEvent).detail as string;
      const id = extractChannelId(href);
      if (id) openChannel(id);
    }
    document.addEventListener('click', onClick);
    window.addEventListener('open-channel-link', onChannelLink);
    return () => {
      document.removeEventListener('click', onClick);
      window.removeEventListener('open-channel-link', onChannelLink);
    };
  }, []);

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

  async function onCreateChannel(title: string, channelUsername: string): Promise<void> {
    const chat = await createChannel(title, channelUsername);
    setChats((prev) => [chat, ...prev.filter((c) => c.chatId !== chat.chatId)]);
    setSelectedId(chat.chatId);
  }

  function onSelect(chatId: string): void {
    setSelectedId(chatId);
    // reset local unread counter on open (read marker — item 16)
    setChats((prev) =>
      prev.map((c) =>
        c.chatId === chatId ? { ...c, unreadCount: 0 } : c,
      ),
    );
  }

  const selectedChat = chats.find((c) => c.chatId === selectedId) ?? null;

  function onShowProfile(userId: string): void {
    setProfileUserId(userId);
  }

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
            <div className="notif-modal-icon"><IconBell /></div>
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
                <IconMenu />
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
              onCreateChannel={onCreateChannel}
              onFocusInput={() => inputRef.current?.focus()}
              onShowProfile={onShowProfile}
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
            onShowProfile={onShowProfile}
            onChatUpdated={(updated) => {
              setChats((prev) =>
                prev.map((c) => (c.chatId === updated.chatId ? updated : c)),
              );
            }}
            onChatRemoved={(chatId) => {
              setChats((prev) => prev.filter((c) => c.chatId !== chatId));
              setSelectedId(null);
            }}
          />
        ) : (
          <div className="conversation-empty">Выберите чат</div>
        )}
      </main>
      {aboutOpen && <AboutDialog onClose={() => setAboutOpen(false)} />}
      {profileUserId && (
        <UserProfileDialog
          userId={profileUserId}
          myId={myId}
          onlineUsers={onlineUsers}
          awayUsers={awayUsers}
          onClose={() => setProfileUserId(null)}
        />
      )}
    </div>
  );
}
