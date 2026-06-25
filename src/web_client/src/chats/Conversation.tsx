import {
  ChangeEvent,
  FormEvent,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import {
  deleteMessage,
  editMessage,
  getMessages,
  sendMessage,
} from '../api/rest';
import type { WsClient } from '../api/ws';
import type { Chat, Message, ServerEvent } from '../api/types';
import {
  decodeContent,
  encodeContent,
  imageDataUrl,
  type MessageContent,
} from '../util/content';
import { formatTime } from '../util/time';
import { chatTitle } from './chatTitle';
import { ImageEditor } from './ImageEditor';
import { MembersDialog } from './MembersDialog';

// Склонение слова «участник» по числу (1 участник, 2 участника, 5 участников).
function pluralMembers(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  let word: string;
  if (mod10 === 1 && mod100 !== 11) word = 'участник';
  else if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14))
    word = 'участника';
  else word = 'участников';
  return `${n} ${word}`;
}

const PAGE = 50;
const TYPING_HIDE_MS = 6000;
const TYPING_SEND_THROTTLE_MS = 2000;

// Модель сообщения в UI. Пока не подтверждено сервером — messageId == null
// (pending), сверка оптимистичного сообщения с WS-эхом идёт по clientMessageId.
interface MsgVM {
  messageId: string | null;
  clientMessageId?: string;
  senderId: string;
  content: MessageContent;
  ts: string;
  pending: boolean;
  failed: boolean;
  deleted: boolean;
  edited: boolean;
}

function fromHistory(m: Message): MsgVM {
  return {
    messageId: m.messageId,
    senderId: m.senderId,
    content: decodeContent(m.ciphertext),
    ts: m.ts,
    pending: false,
    failed: false,
    deleted: m.deleted,
    edited: !!m.editedAt,
  };
}

function order(a: MsgVM, b: MsgVM): number {
  if (a.messageId && b.messageId) return Number(a.messageId) - Number(b.messageId);
  if (!a.messageId && !b.messageId) return a.ts < b.ts ? -1 : 1;
  return a.messageId ? -1 : 1; // подтверждённые раньше pending
}

// Вставка/обновление с дедупликацией по messageId, а для своих ещё и по
// clientMessageId (чтобы WS-эхо слилось с оптимистичным сообщением).
function upsert(list: MsgVM[], vm: Partial<MsgVM> & { senderId: string }): MsgVM[] {
  const idx = list.findIndex(
    (m) =>
      (vm.messageId && m.messageId === vm.messageId) ||
      (vm.clientMessageId &&
        m.clientMessageId &&
        m.clientMessageId === vm.clientMessageId),
  );
  const next = list.slice();
  if (idx >= 0) next[idx] = { ...next[idx], ...vm };
  else next.push(vm as MsgVM);
  next.sort(order);
  return next;
}

export function Conversation({
  chat,
  ws,
  myId,
  onlineUsers,
  onBack,
}: {
  chat: Chat;
  ws: WsClient;
  myId: string | null;
  onlineUsers: Set<string>;
  onBack: () => void;
}): JSX.Element {
  const chatId = chat.chatId;
  const [membersOpen, setMembersOpen] = useState(false);
  const [messages, setMessages] = useState<MsgVM[]>([]);
  const [input, setInput] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [pendingImage, setPendingImage] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [hasMore, setHasMore] = useState(false);
  const [nextBefore, setNextBefore] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [readUpTo, setReadUpTo] = useState(0);
  const [typingFrom, setTypingFrom] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const atBottomRef = useRef(true);
  const typingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastTypingSent = useRef(0);
  const lastReadSent = useRef(0);
  // Свежий chat для сидов внутри эффекта открытия чата (без перезапуска эффекта).
  const chatRef = useRef(chat);
  chatRef.current = chat;

  // Загрузка истории при открытии чата + подписка на живые события чата.
  useEffect(() => {
    let alive = true;
    setMessages([]);
    // Сид статуса прочтения из серверного состояния (а не только из live-событий):
    // иначе при повторном открытии чата ✓✓ деградирует в ✓.
    setReadUpTo(Number(chatRef.current.peerReadUpTo) || 0);
    setEditing(null);
    setInput('');
    setPendingImage(null);
    setMembersOpen(false);
    getMessages(chatId, { limit: PAGE })
      .then((page) => {
        if (!alive) return;
        setMessages(page.messages.map(fromHistory).sort(order));
        setHasMore(page.hasMore);
        setNextBefore(page.nextBefore);
        atBottomRef.current = true;
      })
      .catch(() => undefined);

    const offs = [
      ws.on('message.new', (ev: ServerEvent) => {
        if (ev.chatId !== chatId) return;
        const p = ev.payload as {
          messageId: string;
          senderId: string;
          clientMessageId?: string;
          ciphertext: string;
          ts: string;
        };
        setMessages((prev) =>
          upsert(prev, {
            messageId: p.messageId,
            clientMessageId: p.clientMessageId,
            senderId: p.senderId,
            content: decodeContent(p.ciphertext),
            ts: p.ts,
            pending: false,
            failed: false,
            deleted: false,
            edited: false,
          }),
        );
      }),
      ws.on('message.edited', (ev: ServerEvent) => {
        if (ev.chatId !== chatId) return;
        const p = ev.payload as { messageId: string; ciphertext: string };
        setMessages((prev) =>
          prev.map((m) =>
            m.messageId === p.messageId
              ? { ...m, content: decodeContent(p.ciphertext), edited: true }
              : m,
          ),
        );
      }),
      ws.on('message.deleted', (ev: ServerEvent) => {
        if (ev.chatId !== chatId) return;
        const p = ev.payload as { messageId: string };
        setMessages((prev) =>
          prev.map((m) =>
            m.messageId === p.messageId ? { ...m, deleted: true } : m,
          ),
        );
      }),
      ws.on('message.read', (ev: ServerEvent) => {
        if (ev.chatId !== chatId) return;
        const p = ev.payload as { userId: string; upToMessageId: string };
        if (p.userId === myId) return; // нас интересует прочтение собеседником
        setReadUpTo((cur) => Math.max(cur, Number(p.upToMessageId)));
      }),
      ws.on('typing', (ev: ServerEvent) => {
        if (ev.chatId !== chatId) return;
        const p = ev.payload as { userId: string };
        if (p.userId === myId) return;
        setTypingFrom(true);
        if (typingTimer.current) clearTimeout(typingTimer.current);
        typingTimer.current = setTimeout(
          () => setTypingFrom(false),
          TYPING_HIDE_MS,
        );
      }),
    ];
    return () => {
      alive = false;
      offs.forEach((off) => off());
      if (typingTimer.current) clearTimeout(typingTimer.current);
    };
  }, [chatId, ws, myId]);

  // Автопрокрутка вниз, если пользователь уже у низа.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el && atBottomRef.current) el.scrollTop = el.scrollHeight;
  }, [messages]);

  // Отметка прочтения: при появлении новых сообщений в открытом чате двигаем
  // маркер до последнего сообщения вперёд (см. POST /chats/{id}/read).
  useEffect(() => {
    let maxId = 0;
    for (const m of messages) if (m.messageId) maxId = Math.max(maxId, Number(m.messageId));
    if (maxId > lastReadSent.current) {
      lastReadSent.current = maxId;
      ws.sendRead(chatId, String(maxId));
    }
  }, [messages, chatId, ws]);

  function onInputChange(value: string): void {
    setInput(value);
    if (editing) return;
    const now = Date.now();
    if (now - lastTypingSent.current > TYPING_SEND_THROTTLE_MS) {
      lastTypingSent.current = now;
      ws.sendTyping(chatId);
    }
  }

  async function onScroll(): Promise<void> {
    const el = scrollRef.current;
    if (!el) return;
    atBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    if (el.scrollTop < 40 && hasMore && !loadingMore && nextBefore) {
      setLoadingMore(true);
      const prevHeight = el.scrollHeight;
      try {
        const page = await getMessages(chatId, {
          before: nextBefore,
          limit: PAGE,
        });
        setMessages((prev) => {
          const merged = prev.slice();
          for (const m of page.messages) merged.push(fromHistory(m));
          merged.sort(order);
          return merged;
        });
        setHasMore(page.hasMore);
        setNextBefore(page.nextBefore);
        requestAnimationFrame(() => {
          if (scrollRef.current) {
            scrollRef.current.scrollTop =
              scrollRef.current.scrollHeight - prevHeight;
          }
        });
      } finally {
        setLoadingMore(false);
      }
    }
  }

  // Общий путь отправки (текст и картинка): оптимистичное сообщение +
  // подтверждение WS-эхом по clientMessageId.
  async function sendContent(content: MessageContent): Promise<void> {
    const clientMessageId = crypto.randomUUID();
    const optimistic: MsgVM = {
      messageId: null,
      clientMessageId,
      senderId: myId ?? '',
      content,
      ts: new Date().toISOString(),
      pending: true,
      failed: false,
      deleted: false,
      edited: false,
    };
    atBottomRef.current = true;
    setMessages((prev) => upsert(prev, optimistic));
    try {
      const res = await sendMessage(
        chatId,
        clientMessageId,
        encodeContent(content),
      );
      setMessages((prev) =>
        upsert(prev, {
          ...optimistic,
          messageId: res.messageId,
          ts: res.ts,
          pending: false,
        }),
      );
    } catch {
      setMessages((prev) =>
        upsert(prev, { ...optimistic, pending: false, failed: true }),
      );
    }
  }

  async function onSubmit(e: FormEvent): Promise<void> {
    e.preventDefault();
    const text = input.trim();
    if (!text) return;

    if (editing) {
      const messageId = editing;
      setEditing(null);
      setInput('');
      // оптимистично + событие message.edited подтвердит (правим только текст)
      setMessages((prev) =>
        prev.map((m) =>
          m.messageId === messageId
            ? { ...m, content: { kind: 'text', text }, edited: true }
            : m,
        ),
      );
      try {
        await editMessage(messageId, encodeContent({ kind: 'text', text }));
      } catch {
        /* событие не придёт — оставляем как есть; в v1 без отката */
      }
      return;
    }

    setInput('');
    await sendContent({ kind: 'text', text });
  }

  function onPickFile(e: ChangeEvent<HTMLInputElement>): void {
    const file = e.target.files?.[0];
    e.target.value = ''; // позволить выбрать тот же файл повторно
    if (file) setPendingImage(file);
  }

  function startEdit(m: MsgVM): void {
    if (!m.messageId || m.content.kind !== 'text') return;
    setEditing(m.messageId);
    setInput(m.content.text);
  }

  function cancelEdit(): void {
    setEditing(null);
    setInput('');
  }

  async function onDelete(m: MsgVM): Promise<void> {
    if (!m.messageId) return;
    setMessages((prev) =>
      prev.map((x) =>
        x.messageId === m.messageId ? { ...x, deleted: true } : x,
      ),
    );
    try {
      await deleteMessage(m.messageId);
    } catch {
      /* идемпотентно; событие message.deleted подтвердит */
    }
  }

  // Подзаголовок под названием: для группы — «N участников, M в сети»,
  // для direct — статус собеседника. Себя считаем онлайн (мы подключены).
  const onlineCount = chat.participants.filter(
    (p) => p.userId === myId || onlineUsers.has(p.userId),
  ).length;
  let subtitle: string | null = null;
  if (chat.type === 'group') {
    subtitle = pluralMembers(chat.participants.length);
    if (onlineCount > 0) subtitle += `, ${onlineCount} в сети`;
  } else {
    const other = chat.participants.find((p) => p.userId !== myId);
    if (other) subtitle = onlineUsers.has(other.userId) ? 'в сети' : 'не в сети';
  }
  const isGroup = chat.type === 'group';

  return (
    <div className="conv" data-testid="conversation-open">
      <header className="conv-header">
        <button
          type="button"
          className="conv-back"
          data-testid="conv-back"
          aria-label="Назад к списку чатов"
          onClick={onBack}
        >
          ‹
        </button>
        <button
          type="button"
          className={'conv-headline' + (isGroup ? ' conv-headline--clickable' : '')}
          data-testid="conv-header-info"
          disabled={!isGroup}
          onClick={() => isGroup && setMembersOpen(true)}
        >
          <span className="conv-title">{chatTitle(chat, myId)}</span>
          {subtitle && (
            <span
              className={
                'conv-subtitle' +
                (subtitle === 'в сети' ? ' conv-subtitle--online' : '')
              }
              data-testid="conv-subtitle"
            >
              {subtitle}
            </span>
          )}
        </button>
        {typingFrom && (
          <span className="conv-typing" data-testid="typing-indicator">
            печатает…
          </span>
        )}
      </header>
      <div className="conv-scroll" ref={scrollRef} onScroll={onScroll}>
        {loadingMore && <div className="conv-loading">Загрузка…</div>}
        <div className="conv-messages" data-testid="messages">
          {messages.map((m) => {
            const own = m.senderId === myId;
            const read =
              own && m.messageId ? Number(m.messageId) <= readUpTo : false;
            return (
              <div
                key={m.messageId ?? `pending:${m.clientMessageId}`}
                data-testid="message"
                className={
                  'bubble' +
                  (own ? ' bubble-own' : '') +
                  (m.pending ? ' bubble-pending' : '') +
                  (m.failed ? ' bubble-failed' : '')
                }
              >
                <span className="bubble-content">
                  {m.deleted ? (
                    <em>Сообщение удалено</em>
                  ) : m.content.kind === 'image' ? (
                    <span className="bubble-image">
                      <img
                        data-testid="message-image"
                        src={imageDataUrl(m.content)}
                        alt={m.content.caption || 'изображение'}
                      />
                      {m.content.caption && (
                        <span className="bubble-caption">
                          {m.content.caption}
                        </span>
                      )}
                    </span>
                  ) : (
                    m.content.text
                  )}
                </span>
                {!m.deleted && (
                  <span className="bubble-meta">
                    {m.edited && <span className="bubble-edited">ред.</span>}
                    <span className="bubble-time">{formatTime(m.ts)}</span>
                    {own && m.messageId && (
                      <span className="bubble-status" data-testid="msg-status">
                        {read ? '✓✓' : '✓'}
                      </span>
                    )}
                  </span>
                )}
                {own && !m.deleted && m.messageId && (
                  <span className="bubble-actions">
                    {m.content.kind === 'text' && (
                      <button
                        type="button"
                        data-testid="msg-edit"
                        onClick={() => startEdit(m)}
                      >
                        ред.
                      </button>
                    )}
                    <button
                      type="button"
                      data-testid="msg-delete"
                      onClick={() => onDelete(m)}
                    >
                      удалить
                    </button>
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </div>
      {editing && (
        <div className="conv-editing" data-testid="editing-banner">
          <span>Редактирование</span>
          <button type="button" onClick={cancelEdit}>
            Отмена
          </button>
        </div>
      )}
      <form className="conv-input" onSubmit={onSubmit}>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          hidden
          data-testid="image-input"
          onChange={onPickFile}
        />
        <button
          type="button"
          className="conv-attach"
          data-testid="attach-image"
          aria-label="Прикрепить изображение"
          disabled={!!editing}
          onClick={() => fileInputRef.current?.click()}
        >
          📎
        </button>
        <input
          data-testid="message-input"
          aria-label="Сообщение"
          placeholder="Сообщение…"
          value={input}
          onChange={(e) => onInputChange(e.target.value)}
        />
        <button
          type="submit"
          data-testid="message-send"
          disabled={!input.trim()}
        >
          {editing ? 'Сохранить' : 'Отправить'}
        </button>
      </form>
      {pendingImage && (
        <ImageEditor
          file={pendingImage}
          onCancel={() => setPendingImage(null)}
          onSend={(content) => {
            setPendingImage(null);
            void sendContent(content);
          }}
        />
      )}
      {membersOpen && (
        <MembersDialog
          chat={chat}
          myId={myId}
          onlineUsers={onlineUsers}
          onClose={() => setMembersOpen(false)}
        />
      )}
    </div>
  );
}
