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
  toggleReaction,
  unfurl,
  uploadBlob,
  getDraft,
  saveDraft,
  deleteDraft,
} from '../api/rest';
import type { WsClient } from '../api/ws';
import type { Chat, Message, ReactionGroup, ServerEvent } from '../api/types';
import {
  decodeContent,
  encodeContent,
  linkThumbUrl,
  textContent,
  thumbUrl,
  type Attachment,
  type ImageAttachment,
  type LinkAttachment,
  type MessageContent,
} from '../util/content';
import { imageBytesToThumb, type PreparedImage } from '../util/image';
import { formatTime, formatDateDivider, sameDay, formatLastSeen } from '../util/time';
import { IconAttach, IconCheck, IconChecks, IconCopy, IconEdit, IconReply, IconSend, IconSmilePlus, IconTrash } from '../util/icons';
import { ContextMenu, ContextMenuItem } from './ContextMenu';
import { colorFor, initialFor } from './avatar';
import { chatTitle } from './chatTitle';
import { ImageEditor } from './ImageEditor';
import { EmojiPicker } from './EmojiPicker';
import { MentionPopup, getFilteredParticipants } from './MentionPopup';
import { renderMessageText } from '../util/mentions';
import { MediaViewer } from './MediaViewer';
import { MembersDialog } from './MembersDialog';
import { FormattingToolbar } from './FormattingToolbar';
import { WysiwygComposer, WysiwygComposerHandle } from './WysiwygComposer';
import {
  getChatMessages,
  putMessages,
  patchMessage,
} from '../util/messageCache';
import { LinkDialog } from './LinkDialog';

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
const TYPING_SEND_THROTTLE_MS = 2000;
// Максимальная высота поля ввода (задача #25): дальше — внутренний скролл.
const MAX_INPUT_H = 160;
// Период автоповтора неотправленных сообщений по таймеру (задача #26).
const RETRY_TIMER_MS = 12000;
// Превью ссылок (#32): задержка перед разворачиванием набираемого URL.
const LINK_PREVIEW_DEBOUNCE_MS = 600;

// Первый http(s)-URL в тексте (для живого превью ссылки). Хвостовая пунктуация
// (.,!?;: и закрывающие скобки) отрезается — она обычно не часть адреса.
const URL_RE = /\bhttps?:\/\/[^\s<>"']+/i;
function firstUrl(text: string): string | null {
  const m = text.match(URL_RE);
  if (!m) return null;
  return m[0].replace(/[.,!?;:)\]]+$/, '');
}

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
  replyToMessageId: string | null;
  highlighted: boolean;
  reactions: ReactionGroup[];
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
    replyToMessageId: m.replyToMessageId ?? null,
    highlighted: false,
    reactions: m.reactions ?? [],
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
  awayUsers,
  typingUsers,
  inputRef,
  onBack,
}: {
  chat: Chat;
  ws: WsClient;
  myId: string | null;
  onlineUsers: Set<string>;
  awayUsers: Set<string>;
  typingUsers: Map<string, string>;
  inputRef: React.RefObject<HTMLDivElement>;
  onBack: () => void;
}): JSX.Element {
  const chatId = chat.chatId;
  const [membersOpen, setMembersOpen] = useState(false);
  const [messages, setMessages] = useState<MsgVM[]>([]);
  const [input, setInput] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  // Ответ на сообщение: ID сообщения, на которое отвечаем.
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [pendingImage, setPendingImage] = useState<File | null>(null);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [ctxMenu, setCtxMenu] = useState<{ items: ContextMenuItem[]; x: number; y: number } | null>(null);
  // Пикер реакций: messageId для которого открыт, или null
  const [reactionPickerMsgId, setReactionPickerMsgId] = useState<string | null>(null);
  // Полный эмодзи-пикер (из стрелки в панели реакций)
  const [fullEmojiPickerMsgId, setFullEmojiPickerMsgId] = useState<string | null>(null);
  // @-упоминания: открыт ли попап и фильтр после @
  const [mentionOpen, setMentionOpen] = useState(false);
  const [mentionFilter, setMentionFilter] = useState('');
  const [mentionSelected, setMentionSelected] = useState(0);
  // Панель форматирования (#69): видимость и выделение
  const [formatBarVisible, setFormatBarVisible] = useState(false);
  const [, setSelection] = useState<{ start: number; end: number } | null>(null);
  // Скрывать панель когда поле пустое
  useEffect(() => { if (!input) setFormatBarVisible(false); }, [input]);
  const composerRef = useRef<WysiwygComposerHandle>(null);
  // Диалог ввода ссылки (#69)
  const [linkDialogOpen, setLinkDialogOpen] = useState(false);
  const [linkDialogText, setLinkDialogText] = useState('');
  // Живое превью ссылки в композере (#32) и сопутствующее состояние:
  // previewReqRef — токен против гонок (применяем только последний запрос);
  // shownUrlRef — какой URL уже показан/тянется (не дёргать unfurl на каждый
  // символ); dismissedRef — URL'ы, снятые крестиком (не всплывают снова).
  const [linkPreview, setLinkPreview] = useState<LinkAttachment | null>(null);
  const previewReqRef = useRef(0);
  const shownUrlRef = useRef<string | null>(null);
  // Строка для отслеживания изменений draft в deps useLayoutEffect (#49):
  // меняется при появлении/исчезновении/изменении текста облачка.
  const draftKey =
    typingUsers.size > 0
      ? [...typingUsers.entries()]
          .map(([k, v]) => `${k}:${v}`)
          .join('|')
      : '';
  const dismissedRef = useRef<Set<string>>(new Set());
  // Скорректированная позиция контекстного меню (для EmojiPicker)
  const ctxMenuPosRef = useRef<{ left: number; top: number; width: number; height: number } | null>(null);
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
  const scrollRef = useRef<HTMLDivElement>(null);
  const atBottomRef = useRef(true);
  const lastTypingSent = useRef(0);
  const typingFlushRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastReadSent = useRef(0);
  // Навигация по @: индекс текущего упоминания в списке
  const [mentionNavIndex, setMentionNavIndex] = useState(-1);
  // Свайп вправо для ответа на мобильных
  const swipeRef = useRef<{ startX: number; msgId: string } | null>(null);
  const [swipeMsgId, setSwipeMsgId] = useState<string | null>(null);
  const [swipeX, setSwipeX] = useState(0);
  // Свежий chat для сидов внутри эффекта открытия чата (без перезапуска эффекта).
  const chatRef = useRef(chat);
  chatRef.current = chat;
  // Очередь исходящих (задача #26): отправка строго последовательная, чтобы
  // более позднее сообщение не обогнало раннее. Голова очереди отправляется
  // первой; при ошибке остаётся в голове и блокирует следующие до повтора.
  const sendQueueRef = useRef<
    {
      clientMessageId: string;
      text: string;
      images: OutgoingImage[];
      link?: LinkAttachment;
      replyToMessageId?: string;
    }[]
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
    // Превью ссылок относится к набираемому тексту — сбрасываем при смене чата.
    setLinkPreview(null);
    shownUrlRef.current = null;
    previewReqRef.current++;
    dismissedRef.current.clear();
    // Показываем кеш мгновенно, параллельно тянем свежие данные с сервера.
    getChatMessages(chatId).then((cached) => {
      if (!alive || !cached.length) return;
      setMessages(cached.map(fromHistory).sort(order));
      atBottomRef.current = true;
    }).catch(() => undefined);

    getMessages(chatId, { limit: PAGE })
      .then((page) => {
        if (!alive) return;
        setMessages(page.messages.map(fromHistory).sort(order));
        setHasMore(page.hasMore);
        setNextBefore(page.nextBefore);
        atBottomRef.current = true;
        putMessages(chatId, page.messages).catch(() => undefined);
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
          replyToMessageId?: string;
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
            replyToMessageId: p.replyToMessageId ?? null,
          }),
        );
        // Кеш: сохраняем wire-объект
        putMessages(chatId, [{
          messageId: p.messageId,
          senderId: p.senderId,
          ciphertext: p.ciphertext,
          ts: p.ts,
          editedAt: null,
          deleted: false,
          replyToMessageId: p.replyToMessageId ?? null,
        }]).catch(() => undefined);
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
        patchMessage(chatId, p.messageId, {
          ciphertext: p.ciphertext,
          editedAt: new Date().toISOString(),
        }).catch(() => undefined);
      }),
      ws.on('message.deleted', (ev: ServerEvent) => {
        if (ev.chatId !== chatId) return;
        const p = ev.payload as { messageId: string };
        setMessages((prev) =>
          prev.map((m) =>
            m.messageId === p.messageId ? { ...m, deleted: true } : m,
          ),
        );
        patchMessage(chatId, p.messageId, { deleted: true }).catch(() => undefined);
      }),
      ws.on('message.read', (ev: ServerEvent) => {
        if (ev.chatId !== chatId) return;
        const p = ev.payload as { userId: string; upToMessageId: string };
        if (p.userId === myId) return; // нас интересует прочтение собеседником
        setReadUpTo((cur) => Math.max(cur, Number(p.upToMessageId)));
      }),
      ws.on('message.reaction', (ev: ServerEvent) => {
        if (ev.chatId !== chatId) return;
        const p = ev.payload as {
          messageId: string;
          reactions: ReactionGroup[];
        };
        setMessages((prev) =>
          prev.map((m) =>
            m.messageId === p.messageId
              ? { ...m, reactions: p.reactions }
              : m,
          ),
        );
        patchMessage(chatId, p.messageId, { reactions: p.reactions }).catch(() => undefined);
      }),
    ];
    return () => {
      alive = false;
      offs.forEach((off) => off());
      if (typingFlushRef.current) {
        clearTimeout(typingFlushRef.current);
        typingFlushRef.current = null;
      }
    };
  }, [chatId, ws, myId]);

  // Загрузка черновика при открытии чата (#41).
  useEffect(() => {
    let cancelled = false;
    getDraft(chatId).then(({ ciphertext }) => {
      if (!cancelled && ciphertext) setInput(ciphertext);
    }).catch(() => { /* ignore */ });
    return () => { cancelled = true; };
  }, [chatId]);

  // Сохранение черновика с debounce при вводе (#41).
  const draftTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSavedDraftRef = useRef('');
  useEffect(() => {
    if (draftTimerRef.current) clearTimeout(draftTimerRef.current);
    draftTimerRef.current = setTimeout(() => {
      lastSavedDraftRef.current = input;
      saveDraft(chatId, input).catch(() => { /* ignore */ });
    }, 1500);
    return () => {
      if (draftTimerRef.current) clearTimeout(draftTimerRef.current);
    };
  }, [input, chatId]);

  // Обновление черновика в лайв-режиме с других устройств (#41).
  // Игнорируем draft.updated, если пользователь активно печатает
  // (есть pending save) — иначе старый draft перезатирает ввод.
  useEffect(() => {
    const offDraft = ws.on('draft.updated', (ev) => {
      const evChatId = ev.chatId ?? (ev.payload as { chatId?: string }).chatId;
      if (evChatId !== chatId) return;
      if (draftTimerRef.current) return;
      const ciphertext = (ev.payload as { ciphertext?: string }).ciphertext ?? '';
      setInput(ciphertext);
      lastSavedDraftRef.current = ciphertext;
    });
    const offDelete = ws.on('draft.deleted', (ev) => {
      const evChatId = ev.chatId ?? (ev.payload as { chatId?: string }).chatId;
      if (evChatId !== chatId) return;
      if (draftTimerRef.current) return;
      setInput('');
      lastSavedDraftRef.current = '';
    });
    return () => { offDraft(); offDelete(); };
  }, [chatId, ws]);

  // Автопрокрутка вниз, если пользователь уже у низа (#47).
  // Зависит от messages и draftKey — скроллим при новом сообщении,
  // при появлении/исчезновении draft-облачка и при изменении его текста.
  // Два прохода: useLayoutEffect (до paint) + rAF (после layout), чтобы
  // поймать субпиксельный расчёт Firefox и асинхронные картинки.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el || !atBottomRef.current) return;
    const scrollToBottom = () => { el.scrollTop = el.scrollHeight - el.clientHeight; };
    scrollToBottom();
    const id = requestAnimationFrame(scrollToBottom);
    return () => cancelAnimationFrame(id);
  }, [messages, draftKey]);

  // Авторасширение поля ввода под содержимое (задача #25): сбрасываем высоту и
  // подгоняем под scrollHeight, но не выше потолка — дальше внутренний скролл.
  useLayoutEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, MAX_INPUT_H)}px`;
  }, [input]);

  // Живое превью ссылки (#32): на изменение текста ищем первый URL и с задержкой
  // просим сервер развернуть его. Снятые крестиком и уже показанные URL пропускаем.
  useEffect(() => {
    if (editing) {
      clearPreview();
      return;
    }
    const url = firstUrl(input);
    if (!url || dismissedRef.current.has(url)) {
      clearPreview();
      return;
    }
    if (shownUrlRef.current === url) return; // уже показываем/тянем этот URL
    const t = setTimeout(() => void resolvePreview(url), LINK_PREVIEW_DEBOUNCE_MS);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [input, editing]);

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

  // Таймаут допосылки draft при остановке набора (#48).
  const TYPING_FLUSH_MS = 1000;

  function onInputChange(value: string): void {
    setInput(value);
    // Детект @-упоминаний: ищем последний @ без пробела после
    const lastAt = value.lastIndexOf('@');
    if (lastAt >= 0) {
      const afterAt = value.slice(lastAt + 1);
      if (!/\s/.test(afterAt)) {
        setMentionOpen(true);
        setMentionFilter(afterAt);
        setMentionSelected(0);
      } else {
        setMentionOpen(false);
      }
    } else {
      setMentionOpen(false);
    }
    if (editing) return;
    const now = Date.now();
    // Сброс предыдущего flush-таймера
    if (typingFlushRef.current) clearTimeout(typingFlushRef.current);
    if (now - lastTypingSent.current > TYPING_SEND_THROTTLE_MS) {
      lastTypingSent.current = now;
      ws.sendTyping(chatId, value || undefined);
    }
    // Через TYPING_FLUSH_MS без нового ввода — допослать текущий draft
    // (включая пустой — чтобы очистить draft на другом устройстве)
    typingFlushRef.current = setTimeout(() => {
      ws.sendTyping(chatId, value || undefined);
    }, TYPING_FLUSH_MS);
  }

  // ─── Форматирование текста (#69) ─────────────────────────────────

  // Обработка выделения текста в композере
  function handleSelect(start: number, end: number): void {
    if (start !== end) {
      setFormatBarVisible(true);
      setSelection({ start, end });
    } else {
      setFormatBarVisible(false);
      setSelection(null);
    }
  }

  // Форматирование через execCommand — WYSIWYG
  function onBold(): void { document.execCommand('bold'); }
  function onItalic(): void { document.execCommand('italic'); }
  function onStrike(): void { document.execCommand('strikeThrough'); }
  function onCode(): void {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    const text = sel.getRangeAt(0).toString();
    if (!text) return;
    document.execCommand('insertText', false, '`' + text + '`');
  }

  // Диалог ввода ссылки
  function onLink(): void {
    const sel = window.getSelection();
    const selected = sel?.toString() ?? '';
    setLinkDialogText(selected);
    setLinkDialogOpen(true);
  }

  function onLinkInsert(_text: string, url: string): void {
    document.execCommand('createLink', false, url);
  }

  // Снять текущее превью и инвалидировать любой запрос в полёте (инкремент токена).
  function clearPreview(): void {
    shownUrlRef.current = null;
    previewReqRef.current++;
    setLinkPreview(null);
  }

  // Сообщения, упоминающие текущего пользователя (@username).
  const myUsername = chat.participants.find((p) => p.userId === myId)?.username ?? '';
  const mentionMessages = myUsername
    ? messages.filter((m) =>
        !m.deleted &&
        m.content.text &&
        m.content.text.toLowerCase().includes('@' + myUsername.toLowerCase()),
      )
    : [];

  // Навигация к следующему упоминанию.
  function jumpToNextMention(): void {
    if (mentionMessages.length === 0) return;
    const nextIdx = (mentionNavIndex + 1) % mentionMessages.length;
    setMentionNavIndex(nextIdx);
    const target = mentionMessages[nextIdx];
    const el = scrollRef.current;
    if (!el || !target.messageId) return;
    const targetEl = el.querySelector(`[data-message-id="${target.messageId}"]`);
    if (!targetEl) return;
    const doHighlight = () => {
      setMessages((prev) =>
        prev.map((x) =>
          x.messageId === target.messageId ? { ...x, highlighted: true } : x,
        ),
      );
      setTimeout(() => {
        setMessages((prev) =>
          prev.map((x) =>
            x.messageId === target.messageId ? { ...x, highlighted: false } : x,
          ),
        );
      }, 2000);
    };
    // Если уже видно — подсвечиваем сразу
    const rect = targetEl.getBoundingClientRect();
    const scrollRect = el.getBoundingClientRect();
    if (rect.top >= scrollRect.top && rect.bottom <= scrollRect.bottom) {
      doHighlight();
    } else {
      el.addEventListener('scrollend', () => doHighlight(), { once: true });
      targetEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }

  // Свайп вправо для ответа на мобильных: touch handlers
  function onSwipeTouchStart(e: React.TouchEvent, msgId: string): void {
    swipeRef.current = { startX: e.touches[0].clientX, msgId };
  }
  function onSwipeTouchMove(e: React.TouchEvent): void {
    if (!swipeRef.current) return;
    const dx = e.touches[0].clientX - swipeRef.current.startX;
    if (dx > 0 && dx < 150) {
      setSwipeX(dx);
      setSwipeMsgId(swipeRef.current.msgId);
    }
  }
  function onSwipeTouchEnd(): void {
    if (swipeX > 80 && swipeMsgId) {
      setReplyTo(swipeMsgId);
    }
    swipeRef.current = null;
    setSwipeX(0);
    setSwipeMsgId(null);
  }

  // Выбор пользователя из попапа @-упоминаний.
  function onMentionSelect(username: string): void {
    const el = inputRef.current;
    if (!el) { setMentionOpen(false); return; }
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) { setMentionOpen(false); return; }
    const range = sel.getRangeAt(0);
    const preRange = document.createRange();
    preRange.selectNodeContents(el);
    preRange.setEnd(range.startContainer, range.startOffset);
    const cursorPos = preRange.toString().length;
    const currentText = el.textContent ?? '';
    const lastAt = currentText.lastIndexOf('@');
    if (lastAt < 0) { setMentionOpen(false); return; }
    // Выделяем от @ до курсора
    const selectRange = document.createRange();
    selectRange.setStart(range.startContainer, range.startOffset - (cursorPos - lastAt));
    selectRange.setEnd(range.startContainer, range.startOffset);
    sel.removeAllRanges();
    sel.addRange(selectRange);
    document.execCommand('insertText', false, '@' + username + ' ');
    setMentionOpen(false);
    el.focus();
  }

  // Развернуть URL через сервер и собрать карточку. Токен previewReqRef отсекает
  // устаревшие ответы (пока тянули — текст/URL могли смениться). Картинку превью
  // ужимаем в маленький inline-thumbnail (как у изображений).
  async function resolvePreview(url: string): Promise<void> {
    shownUrlRef.current = url;
    const token = ++previewReqRef.current;
    let preview;
    try {
      ({ preview } = await unfurl(url));
    } catch {
      preview = null;
    }
    if (token !== previewReqRef.current) return; // устарело
    if (!preview) {
      setLinkPreview(null);
      return;
    }
    const thumb = preview.image
      ? await imageBytesToThumb(preview.image.dataBase64, preview.image.mime)
      : '';
    if (token !== previewReqRef.current) return;
    setLinkPreview({
      kind: 'link',
      url: preview.url,
      title: preview.title,
      description: preview.description ?? '',
      siteName: preview.siteName ?? '',
      thumb,
    });
  }

  // Крестик на карточке: запоминаем URL как снятый и убираем превью.
  function dismissPreview(): void {
    if (linkPreview) dismissedRef.current.add(linkPreview.url);
    clearPreview();
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
        putMessages(chatId, page.messages).catch(() => undefined);
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
  function enqueueSend(
    text: string,
    images: OutgoingImage[],
    link?: LinkAttachment,
    replyToMessageId?: string,
  ): void {
    const clientMessageId = crypto.randomUUID();
    const attachments: Attachment[] = [
      ...images.map((i) => i.att),
      ...(link ? [link] : []),
    ];
    const optimistic: MsgVM = {
      messageId: null,
      clientMessageId,
      senderId: myId ?? '',
      content: { text, attachments },
      ts: new Date().toISOString(),
      pending: true,
      failed: false,
      deleted: false,
      edited: false,
      replyToMessageId: replyToMessageId ?? null,
      highlighted: false,
      reactions: [],
    };
    atBottomRef.current = true;
    setMessages((prev) => upsert(prev, optimistic));
    sendQueueRef.current.push({ clientMessageId, text, images, link, replyToMessageId });
    // Набор завершён отправкой — сбрасываем троттл typing и flush-таймер.
    lastTypingSent.current = 0;
    if (typingFlushRef.current) {
      clearTimeout(typingFlushRef.current);
      typingFlushRef.current = null;
    }
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
            attachments: [
              ...head.images.map((i) => i.att),
              ...(head.link ? [head.link] : []),
            ],
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
            head.replyToMessageId,
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
    const text = (composerRef.current?.getMarkdown() ?? '').trim();
    console.log('[DEBUG doSubmit] text:', JSON.stringify(text));
    if (!text) return;

    if (editing) {
      const messageId = editing;
      setEditing(null);
      setInput('');
      composerRef.current?.setMarkdown('');
      setFormatBarVisible(false);
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

    // Прицепляем превью ссылки, если оно готово и его URL ещё есть в тексте (#32).
    const link =
      linkPreview && text.includes(linkPreview.url) ? linkPreview : undefined;
    const replyId = replyTo;
    setInput('');
    composerRef.current?.setMarkdown('');
    setFormatBarVisible(false);
    setReplyTo(null);
    clearPreview();
    deleteDraft(chatId).catch(() => { /* ignore */ });
    ws.sendTyping(chatId);
    enqueueSend(text, [], link, replyId ?? undefined);
  }

  function onSubmit(e: FormEvent): void {
    e.preventDefault();
    void doSubmit();
  }

  // Enter — отправка, Shift+Enter — перенос строки (задача #25). isComposing
  // отсекает Enter, подтверждающий ввод IME (иероглифы и т.п.).
  function onInputKeyDown(e: KeyboardEvent<HTMLDivElement>): void {
    if (e.key === 'Escape' && replyTo) {
      setReplyTo(null);
      return;
    }
    // Горячие клавиши форматирования (#69)
    if ((e.ctrlKey || e.metaKey) && !e.altKey) {
      if (e.key === 'b' || e.key === 'B') {
        e.preventDefault();
        onBold();
        return;
      }
      if (e.key === 'i' || e.key === 'I') {
        e.preventDefault();
        onItalic();
        return;
      }
      if (e.key === 'k' || e.key === 'K') {
        e.preventDefault();
        onLink();
        return;
      }
    }
    // Навигация по попапу @-упоминаний
    if (mentionOpen) {
      const filtered = getFilteredParticipants(chat.participants, mentionFilter, myId);
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setMentionSelected((s) => Math.min(s + 1, filtered.length - 1));
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setMentionSelected((s) => Math.max(s - 1, 0));
        return;
      }
      if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
        e.preventDefault();
        if (filtered[mentionSelected]) {
          onMentionSelect(filtered[mentionSelected].username);
        }
        return;
      }
    }
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
  function onPaste(e: ClipboardEvent<HTMLDivElement>): void {
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
    if (other) {
      if (onlineUsers.has(other.userId)) {
        subtitle = 'в сети';
      } else if (awayUsers.has(other.userId)) {
        subtitle = other.lastActiveAt
          ? `отошёл. ${formatLastSeen(other.lastActiveAt)}`
          : 'отошёл';
      } else if (other.lastActiveAt) {
        subtitle = formatLastSeen(other.lastActiveAt);
      } else {
        subtitle = 'не в сети';
      }
    }
  }
  const isGroup = chat.type === 'group';
  // Имя отправителя по id — для идентификации автора в группе (задача #21).
  const nameOf = (id: string): string =>
    chat.participants.find((p) => p.userId === id)?.username ?? '—';

  // Форматирование строки «печатает» с именами (задача #35).
  // Возвращает текст БЕЗ «...» — анимированные точки добавляются отдельно в JSX.
  const formatTypingText = (users: Map<string, string>): string => {
    const names = [...users.keys()]
      .map((id) => chat.participants.find((p) => p.userId === id)?.username)
      .filter((n): n is string => !!n);
    if (names.length === 0) return 'печатает';
    const MAX_LEN = 40;
    if (names.length === 1) return `${names[0]} печатает`;
    if (names.length === 2) return `${names[0]} и ${names[1]} печатают`;
    // 3+ имён: добавляем по одному, пока влезает. Если не влезает — «и др.».
    let result = names[0];
    for (let i = 1; i < names.length; i++) {
      const candidate = `${result}, ${names[i]}`;
      if (candidate.length + ' печатают'.length <= MAX_LEN) {
        result = candidate;
      } else {
        return `${result} и др. печатают`;
      }
    }
    return `${result} печатают`;
  };

  return (
    <div className={'conv' + (ctxMenu ? ' has-ctx-menu' : '') + (fullEmojiPickerMsgId ? ' has-emoji-picker' : '')} data-testid="conversation-open">
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
                (subtitle === 'в сети' ? ' conv-subtitle--online' :
                 subtitle.startsWith('отошёл') ? ' conv-subtitle--away' : '')
              }
              data-testid="conv-subtitle"
            >
              {subtitle}
            </span>
          )}
        </button>
        {typingUsers.size > 0 && (
          <span className="conv-typing" data-testid="typing-indicator">
            {formatTypingText(typingUsers)}
            <span className="typing-dots" aria-hidden="true">
              <i></i>
              <i></i>
              <i></i>
            </span>
          </span>
        )}
      </header>
      <div
        className="conv-scroll"
        ref={scrollRef}
        onScroll={onScroll}
      >
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
                className={'msg-row' + (own ? ' msg-own' : '') + (m.highlighted ? ' is-highlighted' : '')}
              >
              <div
                data-testid="message"
                data-message-id={m.messageId ?? ''}
                className={
                  'bubble' +
                  (own ? ' bubble-own' : '') +
                  (isGroup && !own ? ' bubble--group-in' : '') +
                  (groupStart ? ' is-group-start' : '') +
                  (groupEnd ? ' is-tail' : '') +
                  (m.pending ? ' bubble-pending' : '') +
                  (m.failed ? ' bubble-failed' : '') +
                  (m.replyToMessageId && messages.some((x) => x.messageId === m.replyToMessageId && x.senderId === myId) ? ' bubble-reply-to-me' : '')
                }
                style={swipeMsgId === m.messageId ? { transform: `translateX(${swipeX}px)` } : undefined}
                onTouchStart={(e) => onSwipeTouchStart(e, m.messageId!)}
                onTouchMove={onSwipeTouchMove}
                onTouchEnd={onSwipeTouchEnd}
                onContextMenu={(e) => {
                  e.preventDefault();
                  if (!m.messageId || m.deleted) return;
                  const ownMsg = m.senderId === myId;
                  const canDelete = ownMsg || (chat.createdBy === myId);
                  const canEdit = ownMsg;
                  const items: ContextMenuItem[] = [
                    { label: 'Ответить', icon: <IconReply />, onClick: () => setReplyTo(m.messageId!) },
                  ];
                  if (canEdit) {
                    items.push({ label: 'Редактировать', icon: <IconEdit />, onClick: () => startEdit(m) });
                  }
                  items.push({ separator: true, label: '', onClick: () => {} });
                  items.push({ label: 'Копировать текст', icon: <IconCopy />, onClick: () => {
                    // Strip markdown: **, _, ~~, `
                    const plain = m.content.text
                      .replace(/\*\*(.+?)\*\*/g, '$1')
                      .replace(/_(.+?)_/g, '$1')
                      .replace(/~~(.+?)~~/g, '$1')
                      .replace(/`([^`]+)`/g, '$1')
                      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
                    navigator.clipboard.writeText(plain);
                  } });
                  if (canDelete) {
                    items.push({ separator: true, label: '', onClick: () => {} });
                    items.push({ label: 'Удалить', icon: <IconTrash />, onClick: () => onDelete(m), danger: true });
                  }
                  setCtxMenu({ items, x: e.clientX, y: e.clientY });
                  setReactionPickerMsgId(m.messageId!);
                  setFullEmojiPickerMsgId(null);
                }}
              >
                {/* Свайп-индикатор: стрелка ответа при свайпе вправо */}
                {swipeMsgId === m.messageId && swipeX > 20 && (
                  <span className="bubble-swipe-indicator" style={{ opacity: Math.min(1, (swipeX - 20) / 60) }}>
                    ↩
                  </span>
                )}
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
                      {/* Превью сообщения, на которое отвечаем (#33) */}
                      {m.replyToMessageId && (() => {
                        const ref = messages.find((x) => x.messageId === m.replyToMessageId);
                        const refName = ref
                          ? chat.participants.find((p) => p.userId === ref.senderId)?.username ?? '—'
                          : '';
                        const refText = ref
                          ? ref.deleted ? 'Сообщение удалено' : ref.content.text.slice(0, 80)
                          : '';
                        return (
                          <span
                            className="bubble-reply"
                            onClick={() => {
                              if (!ref) return;
                              const el = scrollRef.current;
                              if (!el) return;
                              const target = el.querySelector(
                                `[data-message-id="${m.replyToMessageId}"]`,
                              );
                              if (!target) return;
                              const doHighlight = () => {
                                setMessages((prev) =>
                                  prev.map((x) =>
                                    x.messageId === m.replyToMessageId
                                      ? { ...x, highlighted: true }
                                      : x,
                                  ),
                                );
                                setTimeout(() => {
                                  setMessages((prev) =>
                                    prev.map((x) =>
                                      x.messageId === m.replyToMessageId
                                        ? { ...x, highlighted: false }
                                        : x,
                                    ),
                                  );
                                }, 2000);
                              };
                              // Если сообщение уже видно — подсвечиваем сразу
                              const rect = target.getBoundingClientRect();
                              const scrollRect = el.getBoundingClientRect();
                              if (rect.top >= scrollRect.top && rect.bottom <= scrollRect.bottom) {
                                doHighlight();
                              } else {
                                el.addEventListener('scrollend', () => doHighlight(), { once: true });
                                target.scrollIntoView({ behavior: 'smooth', block: 'center' });
                              }
                            }}
                          >
                            <span className="bubble-reply-name" style={{ color: colorFor(refName) }}>
                              {refName}
                            </span>
                            <span className="bubble-reply-text">{refText}</span>
                          </span>
                        );
                      })()}
                      {m.content.text && (
                        <span
                          className="bubble-text"
                          onCopy={(e) => {
                            e.preventDefault();
                            const sel = window.getSelection();
                            if (!sel || sel.rangeCount === 0) return;
                            const range = sel.getRangeAt(0);
                            const fragment = range.cloneContents();
                            const div = document.createElement('div');
                            div.appendChild(fragment);
                            e.clipboardData?.setData('text/html', div.innerHTML);
                            e.clipboardData?.setData('text/plain', sel.toString());
                          }}
                        >
                          {renderMessageText(
                            m.content.text,
                            new Set(chat.participants.map((p) => p.username)),
                          )}
                        </span>
                      )}
                      {m.content.attachments.map((a, ai) =>
                        a.kind === 'image' ? (
                          <span className="bubble-image" key={ai}>
                            <img
                              data-testid="message-image"
                              src={thumbUrl(a)}
                              alt={a.caption || 'изображение'}
                              className={a.blobId ? 'is-openable' : undefined}
                              onClick={() =>
                                a.blobId &&
                                setViewer({
                                  blobId: a.blobId,
                                  caption: a.caption,
                                })
                              }
                            />
                            {a.caption && (
                              <span className="bubble-caption">{a.caption}</span>
                            )}
                          </span>
                        ) : (
                          <a
                            className="bubble-link"
                            key={ai}
                            data-testid="message-link"
                            href={a.url}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            {a.thumb && (
                              <img
                                className="bubble-link-img"
                                src={linkThumbUrl(a)}
                                alt=""
                              />
                            )}
                            <span className="bubble-link-body">
                              {a.siteName && (
                                <span className="bubble-link-site">
                                  {a.siteName}
                                </span>
                              )}
                              <span className="bubble-link-title">{a.title}</span>
                              {a.description && (
                                <span className="bubble-link-desc">
                                  {a.description}
                                </span>
                              )}
                            </span>
                          </a>
                        ),
                      )}
                    </>
                  )}
                </span>
                {!m.deleted && (
                  <span className="bubble-footer">
                    {/* Реакции — слева (#23) */}
                    {m.reactions && m.reactions.length > 0 && (
                      <span className="bubble-reactions">
                        {m.reactions.map((rx) => (
                          <button
                            key={rx.emoji}
                            type="button"
                            className={'bubble-reaction' + (rx.users.includes(myId ?? '') ? ' own' : '')}
                            onClick={() => m.messageId && (trackReaction(rx.emoji), toggleReaction(m.messageId, rx.emoji))}
                          >
                            <span className="bubble-reaction-emoji">{rx.emoji}</span>
                            <span className="bubble-reaction-count">{rx.count}</span>
                          </button>
                        ))}
                      </span>
                    )}
                    <span className="bubble-meta">
                    {m.edited && <IconEdit size={14} className="bubble-edited-icon" />}
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
                {/* Кнопки действий: удалить, редактировать, ответить (#50) */}
                {!m.deleted && m.messageId && (() => {
                  const canDelete = own || (chat.createdBy === myId);
                  const canEdit = own;
                  const canReply = true;
                  if (!canDelete && !canEdit && !canReply) return null;
                  return (
                    <span className="bubble-actions">
                      <button
                        type="button"
                        data-testid="msg-emoji"
                        title="Реакция"
                        onClick={(e) => {
                          const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                          ctxMenuPosRef.current = { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
                          setFullEmojiPickerMsgId(m.messageId!);
                        }}
                      >
                        <IconSmilePlus />
                      </button>
                      {canDelete && (
                        <button
                          type="button"
                          data-testid="msg-delete"
                          title="Удалить"
                          onClick={() => onDelete(m)}
                        >
                          <IconTrash />
                        </button>
                      )}
                      {canEdit && (
                        <button
                          type="button"
                          data-testid="msg-edit"
                          title="Редактировать"
                          onClick={() => startEdit(m)}
                        >
                          <IconEdit />
                        </button>
                      )}
                      {canReply && (
                        <button
                          type="button"
                          data-testid="msg-reply"
                          title="Ответить"
                          onClick={() => setReplyTo(m.messageId!)}
                        >
                          <IconReply />
                        </button>
                      )}
                    </span>
                  );
                })()}
              </div>
              </div>
              </Fragment>
            );
          })}
          {/* Облачко-превью набираемого сообщения (#18 Live Draft) */}
          {typingUsers.size > 0 && (() => {
            // Показываем draft от первого пользователя, у которого есть текст
            for (const [userId, draft] of typingUsers) {
              if (draft) {
                const name = chat.participants.find((p) => p.userId === userId)?.username ?? '—';
                return (
                  <div
                    key={`draft-${userId}`}
                    className="bubble bubble-draft"
                    data-testid="draft-preview"
                  >
                    <span className="bubble-sender" style={{ color: colorFor(name) }}>
                      {name}
                    </span>
                    <span className="bubble-content">
                      <span className="bubble-text">{draft}</span>
                    </span>
                    <span className="bubble-meta">
                      <span className="bubble-draft-status">печатает...</span>
                    </span>
                  </div>
                );
              }
            }
            return null;
          })()}
        </div>
        {mentionMessages.length > 0 && (
          <button
            type="button"
            className="conv-mention-nav"
            data-testid="mention-nav"
            title={`Упоминания (${mentionNavIndex + 1}/${mentionMessages.length})`}
            onClick={jumpToNextMention}
          >
            @{mentionMessages.length}
          </button>
        )}
      </div>
      {editing && (
        <div className="conv-editing" data-testid="editing-banner">
          <span>Редактирование</span>
          <button type="button" onClick={cancelEdit}>
            Отмена
          </button>
        </div>
      )}
      {linkPreview && !editing && (
        <div className="composer-link" data-testid="composer-link-preview">
          {linkPreview.thumb && (
            <img
              className="composer-link-img"
              src={linkThumbUrl(linkPreview)}
              alt=""
            />
          )}
          <div className="composer-link-body">
            {linkPreview.siteName && (
              <span className="composer-link-site">{linkPreview.siteName}</span>
            )}
            <span className="composer-link-title">{linkPreview.title}</span>
            {linkPreview.description && (
              <span className="composer-link-desc">{linkPreview.description}</span>
            )}
          </div>
          <button
            type="button"
            className="composer-link-close"
            data-testid="composer-link-dismiss"
            aria-label="Убрать превью"
            onClick={dismissPreview}
          >
            ×
          </button>
        </div>
      )}
      {replyTo && (() => {
        const msg = messages.find((m) => m.messageId === replyTo);
        if (!msg) return null;
        const name = chat.participants.find((p) => p.userId === msg.senderId)?.username ?? '—';
        const preview = msg.deleted ? 'Сообщение удалено' : msg.content.text.slice(0, 80);
        return (
          <div className="conv-reply-banner" data-testid="reply-banner">
            <span className="conv-reply-text">
              <span className="conv-reply-name" style={{ color: colorFor(name) }}>{name}</span>
              {preview}
            </span>
            <button
              type="button"
              className="conv-reply-close"
              onClick={() => setReplyTo(null)}
              aria-label="Отменить ответ"
            >
              ×
            </button>
          </div>
        );
      })()}
      <div className="conv-composer-wrap">
        <FormattingToolbar
          visible={formatBarVisible}
          onBold={onBold}
          onItalic={onItalic}
          onStrike={onStrike}
          onCode={onCode}
          onLink={onLink}
        />
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
          <button
            type="button"
            className="conv-emoji-btn"
            data-testid="emoji-btn"
            aria-label="Эмодзи"
            onClick={() => setEmojiOpen(!emojiOpen)}
          >
            😊
          </button>
          <WysiwygComposer
            ref={composerRef}
            value={input}
            onChange={onInputChange}
            onKeyDown={onInputKeyDown}
            onPaste={onPaste}
            onSelect={handleSelect}
            divRef={inputRef}
            usernames={new Set(chat.participants.map((p) => p.username))}
            data-testid="message-input"
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
        {emojiOpen && (
          <EmojiPicker
            onSelect={(emoji) => {
              // Вставка эмодзи через execCommand
              const el = inputRef.current;
              if (el) {
                el.focus();
                document.execCommand('insertText', false, emoji);
              } else {
                setInput(input + emoji);
              }
            }}
            onClose={() => setEmojiOpen(false)}
            textareaRef={inputRef}
          />
        )}
        {mentionOpen && (
          <MentionPopup
            participants={chat.participants}
            filter={mentionFilter}
            myId={myId}
            selected={mentionSelected}
            onSelect={onMentionSelect}
            onClose={() => setMentionOpen(false)}
          />
        )}
      </form>
      </div>
      {pendingImage && (
        <ImageEditor
          file={pendingImage}
          onCancel={() => setPendingImage(null)}
          onSend={(prepared, caption) => {
            setPendingImage(null);
            onImagePrepared(prepared, caption);
          }}
          onClose={() => inputRef.current?.focus()}
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
          awayUsers={awayUsers}
          typingUsers={typingUsers}
          onClose={() => setMembersOpen(false)}
        />
      )}
      {ctxMenu && (
        <>
          <ContextMenu
            items={ctxMenu.items}
            x={ctxMenu.x}
            y={ctxMenu.y}
            onPositioned={(pos) => { ctxMenuPosRef.current = pos; }}
            onClose={() => {
              setCtxMenu(null);
              setReactionPickerMsgId(null);
              setFullEmojiPickerMsgId(null);
              
            }}
            reactionBar={reactionPickerMsgId ? (
              <ReactionBar
                onSelect={(emoji) => {
                  toggleReaction(reactionPickerMsgId, emoji);
                  setCtxMenu(null);
                  setReactionPickerMsgId(null);
                  setFullEmojiPickerMsgId(null);
                  
                }}
                onOpenFull={() => {
                  
                  setFullEmojiPickerMsgId(reactionPickerMsgId);
                  setCtxMenu(null);
                  setReactionPickerMsgId(null);
                }}
              />
            ) : undefined}
          />
        </>
      )}
      {/* Полный эмодзи-пикер (из стрелки в панели реакций) */}
      {fullEmojiPickerMsgId && ctxMenuPosRef.current && (
        <PositionedEmojiPicker
          pos={ctxMenuPosRef.current}
          onSelect={(emoji) => {
            trackReaction(emoji);
            toggleReaction(fullEmojiPickerMsgId, emoji);
            setFullEmojiPickerMsgId(null);
          }}
          onClose={() => {
            setFullEmojiPickerMsgId(null);
          }}
        />
      )}
      {/* Диалог ввода ссылки (#69) */}
      {linkDialogOpen && (
        <LinkDialog
          initialText={linkDialogText}
          onInsert={onLinkInsert}
          onClose={() => setLinkDialogOpen(false)}
        />
      )}
    </div>
  );
}

// Панель быстрых реакций — внутри контекстного меню (#23, как в Telegram).
const QUICK_REACTIONS_DEFAULT = ['👍', '❤️', '😂', '😮', '😢', '🙏', '🔥', '👏'];

function getFrequentReactions(): string[] {
  try {
    const raw = localStorage.getItem('emoji_frequent');
    if (!raw) return QUICK_REACTIONS_DEFAULT;
    const counts: Record<string, number> = JSON.parse(raw);
    const sorted = Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .map(([emoji]) => emoji)
      .slice(0, 8);
    if (sorted.length < 8) {
      for (const e of QUICK_REACTIONS_DEFAULT) {
        if (sorted.length >= 8) break;
        if (!sorted.includes(e)) sorted.push(e);
      }
    }
    return sorted;
  } catch {
    return QUICK_REACTIONS_DEFAULT;
  }
}

function trackReaction(emoji: string): void {
  try {
    const raw = localStorage.getItem('emoji_frequent');
    const counts: Record<string, number> = raw ? JSON.parse(raw) : {};
    counts[emoji] = (counts[emoji] || 0) + 1;
    localStorage.setItem('emoji_frequent', JSON.stringify(counts));
  } catch { /* ignore */ }
}

function ReactionBar({
  onSelect,
  onOpenFull,
}: {
  onSelect: (emoji: string) => void;
  onOpenFull: () => void;
}): JSX.Element {
  const [reactions] = useState(getFrequentReactions);

  const handleSelect = (emoji: string) => {
    trackReaction(emoji);
    onSelect(emoji);
  };

  return (
    <div className="reaction-bar" data-testid="reaction-bar">
      {reactions.map((emoji) => (
        <button
          key={emoji}
          type="button"
          className="reaction-bar-btn"
          onMouseDown={(e) => e.stopPropagation()}
          onClick={() => handleSelect(emoji)}
        >
          {emoji}
        </button>
      ))}
      <button
        type="button"
        className="reaction-bar-more"
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          onOpenFull();
        }}
        title="Ещё"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
    </div>
  );
}

// EmojiPicker с авто-коррекцией позиции по экрану (#23).
function PositionedEmojiPicker({
  pos,
  onSelect,
  onClose,
}: {
  pos: { left: number; top: number };
  onSelect: (emoji: string) => void;
  onClose: () => void;
}): JSX.Element {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [style, setStyle] = useState<React.CSSProperties>({
    position: 'fixed',
    left: pos.left,
    top: pos.top,
    zIndex: 200,
  });

  useEffect(() => {
    const maxH = 360;
    const left = Math.min(Math.max(pos.left, 8), window.innerWidth - 328);
    let top = pos.top;
    if (top + maxH + 8 > window.innerHeight) {
      top = window.innerHeight - maxH - 8;
    }
    top = Math.max(8, top);
    setStyle({ position: 'fixed', left, top, zIndex: 200 });
  }, [pos]);

  return (
    <div
      ref={wrapRef}
      className="full-emoji-picker-wrap"
      style={style}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <EmojiPicker onSelect={onSelect} onClose={onClose} />
    </div>
  );
}
