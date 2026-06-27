import {
  ChangeEvent,
  ClipboardEvent,
  Fragment,
  FormEvent,
  KeyboardEvent,
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
  uploadBlob,
} from '../api/rest';
import type { WsClient } from '../api/ws';
import type { Chat, Message, ServerEvent } from '../api/types';
import {
  decodeContent,
  encodeContent,
  textContent,
  thumbUrl,
  type ImageAttachment,
  type MessageContent,
} from '../util/content';
import type { PreparedImage } from '../util/image';
import { formatTime, formatDateDivider, sameDay } from '../util/time';
import { IconAttach, IconCheck, IconChecks, IconSend } from '../util/icons';
import { colorFor, initialFor } from './avatar';
import { chatTitle } from './chatTitle';
import { ImageEditor } from './ImageEditor';
import { MediaViewer } from './MediaViewer';
import { MembersDialog } from './MembersDialog';

// Исходящее изображение в очереди: сырые байты (полноразмерный блоб на загрузку)
// и метаданные вложения. blobId в att заполняется после uploadBlob.
interface OutgoingImage {
  blob: Blob;
  att: ImageAttachment;
}

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
// Максимальная высота поля ввода (задача #25): дальше — внутренний скролл.
const MAX_INPUT_H = 160;
// Период автоповтора неотправленных сообщений по таймеру (задача #26).
const RETRY_TIMER_MS = 12000;

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
  // Открытый lightbox (полноразмерный просмотр) — blobId и подпись.
  const [viewer, setViewer] = useState<{ blobId: string; caption: string } | null>(
    null,
  );
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [hasMore, setHasMore] = useState(false);
  const [nextBefore, setNextBefore] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  // Защита от повторного входа в ленивую подгрузку — именно ref, а не state:
  // несколько scroll-событий в одном тике читают одно (старое) значение state и
  // проскакивают мимо guard'а, загружая одну и ту же страницу дважды → дубли.
  const loadingMoreRef = useRef(false);
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
  const inputRef = useRef<HTMLTextAreaElement>(null);
  // Очередь исходящих (задача #26): отправка строго последовательная, чтобы
  // более позднее сообщение не обогнало раннее. Голова очереди отправляется
  // первой; при ошибке остаётся в голове и блокирует следующие до повтора.
  const sendQueueRef = useRef<
    { clientMessageId: string; text: string; images: OutgoingImage[] }[]
  >([]);
  const pumpingRef = useRef(false);
  const myIdRef = useRef(myId);
  myIdRef.current = myId;

  // Загрузка истории при открытии чата + подписка на живые события чата.
  useEffect(() => {
    let alive = true;
    setMessages([]);
    // Очередь отправки относится к конкретному чату — сбрасываем при переключении.
    sendQueueRef.current = [];
    pumpingRef.current = false;
    // Сид статуса прочтения из серверного состояния (а не только из live-событий):
    // иначе при повторном открытии чата ✓✓ деградирует в ✓.
    setReadUpTo(Number(chatRef.current.peerReadUpTo) || 0);
    setEditing(null);
    setInput('');
    setPendingImage(null);
    setViewer(null);
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

  // Авторасширение поля ввода под содержимое (задача #25): сбрасываем высоту и
  // подгоняем под scrollHeight, но не выше потолка — дальше внутренний скролл.
  useLayoutEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, MAX_INPUT_H)}px`;
  }, [input]);

  // Автоповтор неотправленных (задача #26): при восстановлении сети, после
  // reconnect WS (маркер 'synced') и по таймеру перезапускаем насос очереди.
  useEffect(() => {
    const kick = (): void => retrySend();
    window.addEventListener('online', kick);
    const offSynced = ws.on('synced', kick);
    const timer = setInterval(kick, RETRY_TIMER_MS);
    return () => {
      window.removeEventListener('online', kick);
      offSynced();
      clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ws]);

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
    if (el.scrollTop < 40 && hasMore && !loadingMoreRef.current && nextBefore) {
      loadingMoreRef.current = true;
      setLoadingMore(true);
      const prevHeight = el.scrollHeight;
      try {
        const page = await getMessages(chatId, {
          before: nextBefore,
          limit: PAGE,
        });
        setMessages((prev) => {
          // Дедуп по messageId: страница не должна задвоить уже показанные
          // сообщения, даже если диапазоны перекрылись (гонка подгрузок/сидов).
          const seen = new Set(
            prev.map((m) => m.messageId).filter((id): id is string => !!id),
          );
          const merged = prev.slice();
          for (const m of page.messages) {
            if (seen.has(m.messageId)) continue;
            seen.add(m.messageId);
            merged.push(fromHistory(m));
          }
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
        loadingMoreRef.current = false;
        setLoadingMore(false);
      }
    }
  }

  // Общий путь отправки (текст и/или картинки): оптимистичное сообщение ставится
  // в очередь, дальше pump() грузит блобы и шлёт строго по порядку. Подтверждение
  // — WS-эхом и ответом REST по clientMessageId. att-объекты вложений общие между
  // очередью и оптимистичным content: после загрузки blobId проставится в обоих.
  function enqueueSend(text: string, images: OutgoingImage[]): void {
    const clientMessageId = crypto.randomUUID();
    const optimistic: MsgVM = {
      messageId: null,
      clientMessageId,
      senderId: myId ?? '',
      content: { text, attachments: images.map((i) => i.att) },
      ts: new Date().toISOString(),
      pending: true,
      failed: false,
      deleted: false,
      edited: false,
    };
    atBottomRef.current = true;
    setMessages((prev) => upsert(prev, optimistic));
    sendQueueRef.current.push({ clientMessageId, text, images });
    void pump();
  }

  // Последовательный «насос» очереди: для головы сперва догружаем недостающие
  // блобы, затем шлём сообщение; при успехе — сдвигаем и идём дальше; при ошибке
  // (загрузки или отправки) — помечаем failed и СТОП (голова блокирует очередь до
  // повтора). Повтор переиспользует уже загруженные блобы (blobId сохранён в att).
  // Единственный экземпляр в полёте (pumpingRef).
  async function pump(): Promise<void> {
    if (pumpingRef.current) return;
    pumpingRef.current = true;
    try {
      while (sendQueueRef.current.length > 0) {
        const head = sendQueueRef.current[0];
        setMessages((prev) =>
          prev.map((m) =>
            m.clientMessageId === head.clientMessageId
              ? { ...m, pending: true, failed: false }
              : m,
          ),
        );
        try {
          for (const img of head.images) {
            if (!img.att.blobId) {
              const { blobId } = await uploadBlob(img.blob);
              img.att.blobId = blobId;
            }
          }
          const content: MessageContent = {
            text: head.text,
            attachments: head.images.map((i) => i.att),
          };
          // Прокинуть проставленные blobId в оптимистичное сообщение (чтобы клик
          // по превью открывал полноразмер ещё до прихода WS-эха).
          if (head.images.length) {
            setMessages((prev) =>
              prev.map((m) =>
                m.clientMessageId === head.clientMessageId
                  ? { ...m, content }
                  : m,
              ),
            );
          }
          const res = await sendMessage(
            chatId,
            head.clientMessageId,
            encodeContent(content),
            head.images.map((i) => i.att.blobId),
          );
          setMessages((prev) =>
            upsert(prev, {
              clientMessageId: head.clientMessageId,
              senderId: myIdRef.current ?? '',
              messageId: res.messageId,
              ts: res.ts,
              pending: false,
              failed: false,
            }),
          );
          sendQueueRef.current.shift();
        } catch {
          setMessages((prev) =>
            prev.map((m) =>
              m.clientMessageId === head.clientMessageId
                ? { ...m, pending: false, failed: true }
                : m,
            ),
          );
          break; // не обгоняем застрявшую голову
        }
      }
    } finally {
      pumpingRef.current = false;
    }
  }

  // Повтор: голова всё ещё в очереди — просто перезапускаем насос.
  function retrySend(): void {
    void pump();
  }

  async function doSubmit(): Promise<void> {
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
            ? { ...m, content: textContent(text), edited: true }
            : m,
        ),
      );
      try {
        await editMessage(messageId, encodeContent(textContent(text)));
      } catch {
        /* событие не придёт — оставляем как есть; в v1 без отката */
      }
      return;
    }

    setInput('');
    enqueueSend(text, []);
  }

  function onSubmit(e: FormEvent): void {
    e.preventDefault();
    void doSubmit();
  }

  // Enter — отправка, Shift+Enter — перенос строки (задача #25). isComposing
  // отсекает Enter, подтверждающий ввод IME (иероглифы и т.п.).
  function onInputKeyDown(e: KeyboardEvent<HTMLTextAreaElement>): void {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void doSubmit();
    }
  }

  function onPickFile(e: ChangeEvent<HTMLInputElement>): void {
    const file = e.target.files?.[0];
    e.target.value = ''; // позволить выбрать тот же файл повторно
    if (file) setPendingImage(file);
  }

  // Вставка изображения из буфера (Ctrl/Cmd+V): если в буфере есть картинка —
  // открываем тот же редактор, что и при прикреплении через 📎 (issue #17).
  // При редактировании вложения не добавляем — обычная вставка текста.
  function onPaste(e: ClipboardEvent<HTMLTextAreaElement>): void {
    if (editing) return;
    const items = e.clipboardData?.items;
    if (!items) return;
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if (it.kind === 'file' && it.type.startsWith('image/')) {
        const file = it.getAsFile();
        if (file) {
          e.preventDefault(); // не вставлять в textarea сопутствующий текст
          setPendingImage(file);
          return;
        }
      }
    }
  }

  function startEdit(m: MsgVM): void {
    // Редактируем только чисто текстовые сообщения (без вложений).
    if (!m.messageId || m.content.attachments.length > 0) return;
    setEditing(m.messageId);
    setInput(m.content.text);
  }

  // Из редактора изображения: собираем вложение с thumbnail и ставим в очередь
  // (полный блоб загрузится в pump). Подпись хранится на вложении.
  function onImagePrepared(prepared: PreparedImage, caption: string): void {
    const att: ImageAttachment = {
      kind: 'image',
      blobId: '',
      mime: prepared.mime,
      width: prepared.width,
      height: prepared.height,
      size: prepared.full.size,
      thumb: prepared.thumb,
      caption,
    };
    enqueueSend('', [{ blob: prepared.full, att }]);
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
  // Имя отправителя по id — для идентификации автора в группе (задача #21).
  const nameOf = (id: string): string =>
    chat.participants.find((p) => p.userId === id)?.username ?? '—';

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
            печатает
            <span className="typing-dots" aria-hidden="true">
              <i></i>
              <i></i>
              <i></i>
            </span>
          </span>
        )}
      </header>
      <div className="conv-scroll" ref={scrollRef} onScroll={onScroll}>
        {loadingMore && <div className="conv-loading">Загрузка…</div>}
        <div className="conv-messages" data-testid="messages">
          {messages.map((m, i) => {
            const own = m.senderId === myId;
            const read =
              own && m.messageId ? Number(m.messageId) <= readUpTo : false;
            const prev = messages[i - 1];
            const next = messages[i + 1];
            // Новый календарный день — разделитель дат перед сообщением.
            const showDate = !prev || !sameDay(prev.ts, m.ts);
            // Группировка подряд идущих сообщений одного автора в пределах дня:
            // хвостик — только у последнего в группе, верхний отступ — у первого.
            const groupStart =
              !prev || prev.senderId !== m.senderId || showDate;
            const groupEnd =
              !next ||
              next.senderId !== m.senderId ||
              !sameDay(m.ts, next.ts);
            return (
              <Fragment key={m.messageId ?? `pending:${m.clientMessageId}`}>
                {showDate && (
                  <div className="date-divider" data-testid="date-divider">
                    <span>{formatDateDivider(m.ts)}</span>
                  </div>
                )}
              <div
                data-testid="message"
                className={
                  'bubble' +
                  (own ? ' bubble-own' : '') +
                  (isGroup && !own ? ' bubble--group-in' : '') +
                  (groupStart ? ' is-group-start' : '') +
                  (groupEnd ? ' is-tail' : '') +
                  (m.pending ? ' bubble-pending' : '') +
                  (m.failed ? ' bubble-failed' : '')
                }
              >
                {/* Аватар автора у последнего пузыря серии (группа, чужие) — #21 */}
                {isGroup && !own && groupEnd && (
                  <span
                    className="bubble-avatar"
                    aria-hidden="true"
                    style={{ background: colorFor(nameOf(m.senderId)) }}
                  >
                    {initialFor(nameOf(m.senderId))}
                  </span>
                )}
                {/* Имя автора над первым пузырём серии (группа, чужие) — #21 */}
                {isGroup && !own && groupStart && (
                  <span
                    className="bubble-sender"
                    data-testid="bubble-sender"
                    style={{ color: colorFor(nameOf(m.senderId)) }}
                  >
                    {nameOf(m.senderId)}
                  </span>
                )}
                <span className="bubble-content">
                  {m.deleted ? (
                    <em>Сообщение удалено</em>
                  ) : (
                    <>
                      {m.content.attachments.map((a, ai) => (
                        <span className="bubble-image" key={ai}>
                          <img
                            data-testid="message-image"
                            src={thumbUrl(a)}
                            alt={a.caption || 'изображение'}
                            className={a.blobId ? 'is-openable' : undefined}
                            onClick={() =>
                              a.blobId &&
                              setViewer({ blobId: a.blobId, caption: a.caption })
                            }
                          />
                          {a.caption && (
                            <span className="bubble-caption">{a.caption}</span>
                          )}
                        </span>
                      ))}
                      {m.content.text && (
                        <span className="bubble-text">{m.content.text}</span>
                      )}
                    </>
                  )}
                </span>
                {!m.deleted && (
                  <span className="bubble-meta">
                    {m.edited && <span className="bubble-edited">ред.</span>}
                    <span className="bubble-time">{formatTime(m.ts)}</span>
                    {/* Статус доставки своих сообщений (#24/#26): отправка —
                        спиннер, ошибка — «!», отправлено — одна галочка,
                        прочитано — двойная синяя. */}
                    {own &&
                      (m.failed ? (
                        <span
                          className="bubble-status is-failed"
                          data-testid="msg-status"
                          data-status="failed"
                          title="Не отправлено"
                          aria-label="Не отправлено"
                        >
                          !
                        </span>
                      ) : m.pending ? (
                        <span
                          className="bubble-spinner"
                          data-testid="msg-status"
                          data-status="sending"
                          aria-label="Отправка"
                        />
                      ) : m.messageId ? (
                        <span
                          className={'bubble-status' + (read ? ' is-read' : '')}
                          data-testid="msg-status"
                          data-status={read ? 'read' : 'sent'}
                          aria-label={read ? 'Прочитано' : 'Отправлено'}
                        >
                          {read ? <IconChecks /> : <IconCheck />}
                        </span>
                      ) : null)}
                  </span>
                )}
                {own && m.failed && (
                  <button
                    type="button"
                    className="bubble-retry"
                    data-testid="msg-retry"
                    onClick={retrySend}
                  >
                    Повторить
                  </button>
                )}
                {own && !m.deleted && m.messageId && (
                  <span className="bubble-actions">
                    {m.content.attachments.length === 0 && (
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
              </Fragment>
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
        <div className="conv-input-field">
          <button
            type="button"
            className="conv-attach"
            data-testid="attach-image"
            aria-label="Прикрепить изображение"
            disabled={!!editing}
            onClick={() => fileInputRef.current?.click()}
          >
            <IconAttach />
          </button>
          <textarea
            ref={inputRef}
            className="conv-textarea"
            data-testid="message-input"
            aria-label="Сообщение"
            placeholder="Сообщение…"
            rows={1}
            value={input}
            onChange={(e) => onInputChange(e.target.value)}
            onKeyDown={onInputKeyDown}
            onPaste={onPaste}
          />
        </div>
        <button
          type="submit"
          className="conv-send"
          data-testid="message-send"
          aria-label={editing ? 'Сохранить' : 'Отправить'}
          disabled={!input.trim()}
        >
          <IconSend />
        </button>
      </form>
      {pendingImage && (
        <ImageEditor
          file={pendingImage}
          onCancel={() => setPendingImage(null)}
          onSend={(prepared, caption) => {
            setPendingImage(null);
            onImagePrepared(prepared, caption);
          }}
        />
      )}
      {viewer && (
        <MediaViewer
          blobId={viewer.blobId}
          caption={viewer.caption}
          onClose={() => setViewer(null)}
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
