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
import { useTranslation } from 'react-i18next';
import {
  deleteMessage,
  editMessage,
  getMessages,
  pinMessage,
  unpinMessage,
  sendMessage,
  toggleReaction,
  unfurl,
  uploadBlob,
  getDraft,
  saveDraft,
  deleteDraft,
  fetchBlob,
  subscribeChannel,
} from '../api/rest';
import type { WsClient } from '../api/ws';
import type { Chat, Message, ReactionGroup, ServerEvent } from '../api/types';
import i18n from '../i18n';
import {
  decodeContent,
  encodeContent,
  linkThumbUrl,
  previewText,
  textContent,
  thumbUrl,
  type Attachment,
  type AudioAttachment,
  type ImageAttachment,
  type LinkAttachment,
  type MessageContent,
  type VideoAttachment,
  type FileAttachment,
} from '../util/content';
import { imageBytesToThumb, videoPosterFrame, type PreparedImage } from '../util/image';
import { formatTime, formatDateDivider, sameDay, formatLastSeen } from '../util/time';
import { IconAttach, IconCheck, IconChecks, IconCopy, IconEdit, IconReply, IconSend, IconSmilePlus, IconTrash, IconArrowDown, IconRotateCcw, IconX, IconArrowLeft, IconAlertCircle, IconMic, IconCamera, IconPlay, IconPhone, IconVideoCam, IconImage, IconForward, IconPin } from '../util/icons';
import { ContextMenu, ContextMenuItem } from './ContextMenu';
import { colorFor, initialFor } from './avatar';
import { chatTitle } from './chatTitle';
import { ImageEditor } from './ImageEditor';
import { EmojiPicker } from './EmojiPicker';
import { MediaPanel } from './MediaPanel';
import { MentionPopup, getFilteredParticipants } from './MentionPopup';
import { renderMessageText } from '../util/mentions';
import { MediaViewer } from './MediaViewer';
import { MediaGallery } from './MediaGallery';
import { VoiceBubble, type VoiceBubbleHandle } from './VoiceBubble';
import { MembersDialog } from './MembersDialog';
import { GroupInfoDialog } from './GroupInfoDialog';
import { ChannelInfoDialog } from './ChannelInfoDialog';
import { FormattingToolbar } from './FormattingToolbar';
import { WysiwygComposer, WysiwygComposerHandle } from './WysiwygComposer';
import { useVoiceRecorder, type VoiceRecording } from './useVoiceRecorder';
import { VideoRecorderModal, type VideoRecording } from './VideoRecorderModal';
import {
  getChatMessages,
  putMessages,
  patchMessage,
} from '../util/messageCache';
import { LinkDialog } from './LinkDialog';

// Outgoing image in the queue: raw bytes (full-size blob to upload)
// plus attachment metadata. blobId in att is filled in after uploadBlob.
interface OutgoingImage {
  blob: Blob;
  att: ImageAttachment;
}

// Seconds → m:ss (recording timer, voice/video durations).
function fmtSec(total: number): string {
  const m = Math.floor(total / 60);
  const s = Math.floor(total % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

// Bytes → human-readable size for the file card (#85).
function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} ${i18n.t('conv.sizeB')}`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} ${i18n.t('conv.sizeKb')}`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} ${i18n.t('conv.sizeMb')}`;
}

// Member count label — plural forms come from the locale dict (#58):
// ru has one/few/many forms, en just "member/members".
function pluralMembers(n: number): string {
  return i18n.t('conv.membersCount', { count: n });
}

const PAGE = 50;
const TYPING_SEND_THROTTLE_MS = 2000;
// Max input height (issue #25): beyond this, inner scrolling.
const MAX_INPUT_H = 160;
// Timer interval for auto-retrying unsent messages (issue #26).
const RETRY_TIMER_MS = 12000;
// Link previews (#32): delay before unfurling the URL being typed.
const LINK_PREVIEW_DEBOUNCE_MS = 600;

// First http(s) URL in text (for live link preview). Trailing punctuation
// (.,!?;: and closing brackets) is stripped — usually not part of the address.
const URL_RE = /\bhttps?:\/\/[^\s<>"']+/i;
function firstUrl(text: string): string | null {
  const m = text.match(URL_RE);
  if (!m) return null;
  return m[0].replace(/[.,!?;:)\]]+$/, '');
}

// UI message model. Until confirmed by the server, messageId == null
// (pending); the optimistic message is matched against the WS echo by clientMessageId.
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
  viewCount: number;
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
    viewCount: m.viewCount ?? 0,
  };
}

function order(a: MsgVM, b: MsgVM): number {
  if (a.messageId && b.messageId) return Number(a.messageId) - Number(b.messageId);
  if (!a.messageId && !b.messageId) return a.ts < b.ts ? -1 : 1;
  return a.messageId ? -1 : 1; // confirmed before pending
}

// Insert/update with dedup by messageId, and for own messages also by
// clientMessageId (so the WS echo merges with the optimistic message).
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
  onShowProfile,
  onCall,
  onForward,
  onChatUpdated,
  onChatRemoved,
}: {
  chat: Chat;
  ws: WsClient;
  myId: string | null;
  onlineUsers: Set<string>;
  awayUsers: Set<string>;
  typingUsers: Map<string, string>;
  inputRef: React.RefObject<HTMLDivElement>;
  onBack: () => void;
  onShowProfile: (userId: string) => void;
  onCall?: (peerId: string, video: boolean) => void;
  onForward?: (message: MsgVM) => void;
  onChatUpdated: (chat: Chat) => void;
  onChatRemoved: (chatId: string) => void;
}): JSX.Element {
  const chatId = chat.chatId;
  const [membersOpen, setMembersOpen] = useState(false);
  const [groupInfoOpen, setGroupInfoOpen] = useState(false);
  // Chat media gallery (#82).
  const [galleryOpen, setGalleryOpen] = useState(false);
  const [messages, setMessages] = useState<MsgVM[]>([]);
  // Pinned message bar preview (#86): resolved from history or a targeted fetch.
  const [pinnedPreview, setPinnedPreview] = useState<{
    id: string;
    name: string;
    text: string;
  } | null>(null);

  // Resolve the pinned message preview: from loaded history first, otherwise
  // fetch exactly that one message (pagination is by messageId < N, so
  // before = id+1 with limit 1 returns precisely the pinned message).
  useEffect(() => {
    const pid = chat.pinnedMessageId;
    if (!pid) {
      setPinnedPreview(null);
      return;
    }
    const local = messages.find((m) => m.messageId === pid);
    if (local) {
      setPinnedPreview({
        id: pid,
        name:
          chat.participants.find((p) => p.userId === local.senderId)?.username ?? '—',
        text: previewText(local.content).slice(0, 90),
      });
      return;
    }
    let alive = true;
    void getMessages(chatId, { before: String(BigInt(pid) + BigInt(1)), limit: 1 })
      .then((page) => {
        const m = page.messages[0];
        if (!alive) return;
        if (!m || m.messageId !== pid) {
          setPinnedPreview({ id: pid, name: '', text: i18n.t('conv.pinnedFallback') });
          return;
        }
        const content = decodeContent(m.ciphertext);
        setPinnedPreview({
          id: pid,
          name:
            chat.participants.find((p) => p.userId === m.senderId)?.username ?? '—',
          text: previewText(content).slice(0, 90),
        });
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [chat.pinnedMessageId, chat.participants, chatId, messages]);
  const [input, setInput] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  // Reply state: ID of the message being replied to.
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [pendingImage, setPendingImage] = useState<File | null>(null);
  const [mediaOpen, setMediaOpen] = useState(false);
  // Voice/video (#34): button mode (click toggles), camera modal
  // (key>0 means open, incremented to remount on "Re-record"),
  // swipe-to-cancel during hold-to-record voice.
  const [micMode, setMicMode] = useState<'voice' | 'video'>('voice');
  const [videoRecKey, setVideoRecKey] = useState(0);
  const [recCancelArmed, setRecCancelArmed] = useState(false);
  const { t } = useTranslation();
  const [ctxMenu, setCtxMenu] = useState<{ items: ContextMenuItem[]; x: number; y: number } | null>(null);
  // Reaction picker: messageId it is open for, or null
  const [reactionPickerMsgId, setReactionPickerMsgId] = useState<string | null>(null);
  // Full emoji picker (from the arrow in the reaction bar)
  const [fullEmojiPickerMsgId, setFullEmojiPickerMsgId] = useState<string | null>(null);
  // @-mentions: whether the popup is open and the filter after @
  const [mentionOpen, setMentionOpen] = useState(false);
  const [mentionFilter, setMentionFilter] = useState('');
  const [mentionSelected, setMentionSelected] = useState(0);
  // Formatting toolbar (#69): visibility and selection
  const [formatBarVisible, setFormatBarVisible] = useState(false);
  const [, setSelection] = useState<{ start: number; end: number } | null>(null);
  // Hide the toolbar when the input is empty
  useEffect(() => { if (!input) setFormatBarVisible(false); }, [input]);
  const composerRef = useRef<WysiwygComposerHandle>(null);
  // Link input dialog (#69)
  const [linkDialogOpen, setLinkDialogOpen] = useState(false);
  const [linkDialogText, setLinkDialogText] = useState('');
  // Live link preview in the composer (#32) and related state:
  // previewReqRef — token against races (only the latest request applies);
  // shownUrlRef — which URL is already shown/being fetched (don't call unfurl
  // on every keystroke); dismissedRef — URLs dismissed via X (won't reappear).
  const [linkPreview, setLinkPreview] = useState<LinkAttachment | null>(null);
  const previewReqRef = useRef(0);
  const shownUrlRef = useRef<string | null>(null);
  // String to track draft changes in useLayoutEffect deps (#49):
  // changes when the draft bubble appears/disappears or its text changes.
  const draftKey =
    typingUsers.size > 0
      ? [...typingUsers.entries()]
          .map(([k, v]) => `${k}:${v}`)
          .join('|')
      : '';
  const dismissedRef = useRef<Set<string>>(new Set());
  // Adjusted context menu position (for EmojiPicker)
  const ctxMenuPosRef = useRef<{ left: number; top: number; width: number; height: number } | null>(null);
  // Open lightbox (full-size view) — blobId, caption and media type.
  const [viewer, setViewer] = useState<{ blobId: string; caption: string; kind?: 'image' | 'video' } | null>(
    null,
  );
  // Voice players (#34): refs keyed by messageId — for playlist auto-advance.
  const voiceRefs = useRef<Map<string, VoiceBubbleHandle>>(new Map());
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [hasMore, setHasMore] = useState(false);
  const [nextBefore, setNextBefore] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  // Guard against re-entering lazy loading — a ref, not state: several scroll
  // events in one tick read the same (stale) state value, skip past the guard,
  // and load the same page twice → duplicates.
  const loadingMoreRef = useRef(false);
  const [readUpTo, setReadUpTo] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const atBottomRef = useRef(true);
  const [showScrollBtn, setShowScrollBtn] = useState(false);
  const [newCount, setNewCount] = useState(0);
  // Navigation stack: save the current scrollTop when jumping to a message
  const navStackRef = useRef<number[]>([]);
  const [showBackBtn, setShowBackBtn] = useState(false);
  const lastTypingSent = useRef(0);
  const typingFlushRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastReadSent = useRef(0);
  // @ navigation: index of the current mention in the list
  const [mentionNavIndex, setMentionNavIndex] = useState(-1);
  // Swipe right to reply on mobile
  const swipeRef = useRef<{ startX: number; msgId: string } | null>(null);
  const savedRangeRef = useRef<Range | null>(null);
  const [swipeMsgId, setSwipeMsgId] = useState<string | null>(null);
  const [swipeX, setSwipeX] = useState(0);
  // Fresh chat for seeds inside the chat-open effect (no effect restart).
  const chatRef = useRef(chat);
  chatRef.current = chat;
  // Outgoing queue (issue #26): sending is strictly sequential so a later
  // message never overtakes an earlier one. The queue head is sent first;
  // on error it stays at the head and blocks the rest until retry.
  const sendQueueRef = useRef<
    {
      clientMessageId: string;
      text: string;
      images: OutgoingImage[];
      link?: LinkAttachment;
      // Voice/video (#34) and documents (#85): raw blob + attachment metadata.
      media?: { att: AudioAttachment | VideoAttachment | FileAttachment; blob: Blob };
      replyToMessageId?: string;
    }[]
  >([]);
  const pumpingRef = useRef(false);
  const myIdRef = useRef(myId);
  myIdRef.current = myId;

  // Load history on chat open + subscribe to live chat events.
  useEffect(() => {
    let alive = true;
    setMessages([]);
    // The send queue belongs to a specific chat — reset on switch.
    sendQueueRef.current = [];
    pumpingRef.current = false;
    // Seed read status from server state (not just live events):
    // otherwise reopening a chat degrades ✓✓ back to ✓.
    setReadUpTo(Number(chatRef.current.peerReadUpTo) || 0);
    setEditing(null);
    setInput('');
    setPendingImage(null);
    setViewer(null);
    setMembersOpen(false);
    // Link preview belongs to the text being typed — reset on chat switch.
    setLinkPreview(null);
    shownUrlRef.current = null;
    previewReqRef.current++;
    dismissedRef.current.clear();
    navStackRef.current = [];
    setShowBackBtn(false);
    // Show cache instantly while fetching fresh data from the server in parallel.
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
        // User is scrolled away — count as new
        if (!atBottomRef.current && p.senderId !== myId) {
          setNewCount((c) => c + 1);
        }
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
        // Cache: store the wire object
        putMessages(chatId, [{
          messageId: p.messageId,
          senderId: p.senderId,
          ciphertext: p.ciphertext,
          ts: p.ts,
          editedAt: null,
          deleted: false,
          replyToMessageId: p.replyToMessageId ?? null,
          viewCount: 0,
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
        if (p.userId === myId) return; // we only care about the peer's read receipt
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

  // Load draft on chat open (#41).
  useEffect(() => {
    let cancelled = false;
    getDraft(chatId).then(({ ciphertext }) => {
      if (!cancelled && ciphertext) setInput(ciphertext);
    }).catch(() => { /* ignore */ });
    return () => { cancelled = true; };
  }, [chatId]);

  // Save draft with debounce while typing (#41).
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

  // Live draft updates from other devices (#41).
  // Ignore draft.updated if the user is actively typing
  // (a pending save exists) — otherwise a stale draft overwrites the input.
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

  // Auto-scroll to bottom if the user is already near it (#47).
  // Depends on messages and draftKey — scroll on new message,
  // on draft bubble appear/disappear, and on its text change.
  // Two passes: useLayoutEffect (before paint) + rAF (after layout) to catch
  // Firefox subpixel layout and async images.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el || !atBottomRef.current) return;
    const scrollToBottom = () => { el.scrollTop = el.scrollHeight - el.clientHeight; };
    scrollToBottom();
    const id = requestAnimationFrame(scrollToBottom);
    return () => cancelAnimationFrame(id);
  }, [messages, draftKey]);

  // On mobile, opening a chat may focus the contentEditable and bring up the
  // keyboard — blur the input on mount (#72).
  useEffect(() => {
    if (!('ontouchstart' in window)) return;
    const el = inputRef.current;
    if (el && el === document.activeElement) {
      el.blur();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatId]);

  // Auto-grow the input to fit its content (issue #25): reset height and fit
  // scrollHeight, capped at the max — beyond that, inner scrolling.
  useLayoutEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, MAX_INPUT_H)}px`;
  }, [input]);

  // Live link preview (#32): on text change find the first URL and ask the
  // server to unfurl it after a delay. Skip dismissed and already-shown URLs.
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
    if (shownUrlRef.current === url) return; // already showing/fetching this URL
    const t = setTimeout(() => void resolvePreview(url), LINK_PREVIEW_DEBOUNCE_MS);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [input, editing]);

  // Auto-retry unsent (issue #26): restart the queue pump on network recovery,
  // after WS reconnect ('synced' marker), and on a timer.
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

  // Read marker: when new messages arrive in the open chat, advance the marker
  // up to the last message (see POST /chats/{id}/read).
  useEffect(() => {
    let maxId = 0;
    for (const m of messages) if (m.messageId) maxId = Math.max(maxId, Number(m.messageId));
    if (maxId > lastReadSent.current) {
      lastReadSent.current = maxId;
      ws.sendRead(chatId, String(maxId));
    }
  }, [messages, chatId, ws]);

  // Timeout to flush the draft after typing stops (#48).
  const TYPING_FLUSH_MS = 1000;

  function onInputChange(value: string): void {
    setInput(value);
    // Detect @-mentions: look for the last @ with no whitespace after it
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
    // Reset the previous flush timer
    if (typingFlushRef.current) clearTimeout(typingFlushRef.current);
    if (now - lastTypingSent.current > TYPING_SEND_THROTTLE_MS) {
      lastTypingSent.current = now;
      ws.sendTyping(chatId, value || undefined);
    }
    // After TYPING_FLUSH_MS without new input — send the current draft
    // (including empty, to clear the draft on other devices)
    typingFlushRef.current = setTimeout(() => {
      ws.sendTyping(chatId, value || undefined);
    }, TYPING_FLUSH_MS);
  }

  // ─── Text formatting (#69) ─────────────────────────────────

  // Handle text selection in the composer
  function handleSelect(start: number, end: number): void {
    if (start !== end) {
      setFormatBarVisible(true);
      setSelection({ start, end });
    } else {
      setFormatBarVisible(false);
      setSelection(null);
    }
  }

  // Formatting via execCommand — WYSIWYG
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

  // Link input dialog
  function onLink(): void {
    const sel = window.getSelection();
    const selected = sel?.toString() ?? '';
    setLinkDialogText(selected);
    setLinkDialogOpen(true);
  }

  function onLinkInsert(_text: string, url: string): void {
    document.execCommand('createLink', false, url);
  }

  // Clear the current preview and invalidate any in-flight request (bump the token).
  function clearPreview(): void {
    shownUrlRef.current = null;
    previewReqRef.current++;
    setLinkPreview(null);
  }

  // Messages mentioning the current user (@username).
  const myUsername = chat.participants.find((p) => p.userId === myId)?.username ?? '';
  const mentionMessages = myUsername
    ? messages.filter((m) =>
        !m.deleted &&
        m.content.text &&
        m.content.text.toLowerCase().includes('@' + myUsername.toLowerCase()),
      )
    : [];

  // Jump to the next mention.
  function jumpToNextMention(): void {
    if (mentionMessages.length === 0) return;
    const nextIdx = (mentionNavIndex + 1) % mentionMessages.length;
    setMentionNavIndex(nextIdx);
    const target = mentionMessages[nextIdx];
    const el = scrollRef.current;
    if (!el || !target.messageId) return;
    const targetEl = el.querySelector(`[data-message-id="${target.messageId}"]`);
    if (!targetEl) return;
    pushNavStack();
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
    // Already visible — highlight right away
    const rect = targetEl.getBoundingClientRect();
    const scrollRect = el.getBoundingClientRect();
    if (rect.top >= scrollRect.top && rect.bottom <= scrollRect.bottom) {
      doHighlight();
    } else {
      el.addEventListener('scrollend', () => doHighlight(), { once: true });
      targetEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }

  // Swipe right to reply on mobile: touch handlers
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

  // Selecting a user from the @-mention popup.
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
    // Select from the @ to the cursor
    const selectRange = document.createRange();
    selectRange.setStart(range.startContainer, range.startOffset - (cursorPos - lastAt));
    selectRange.setEnd(range.startContainer, range.startOffset);
    sel.removeAllRanges();
    sel.addRange(selectRange);
    document.execCommand('insertText', false, '@' + username + ' ');
    setMentionOpen(false);
    el.focus();
  }

  // Unfurl the URL via the server and build the card. The previewReqRef token
  // discards stale responses (while fetching, text/URL may have changed).
  // The preview image is shrunk into a small inline thumbnail (like images).
  async function resolvePreview(url: string): Promise<void> {
    shownUrlRef.current = url;
    const token = ++previewReqRef.current;
    let preview;
    try {
      ({ preview } = await unfurl(url));
    } catch {
      preview = null;
    }
    if (token !== previewReqRef.current) return; // stale
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

  // X on the card: mark the URL as dismissed and remove the preview.
  function dismissPreview(): void {
    if (linkPreview) dismissedRef.current.add(linkPreview.url);
    clearPreview();
  }

  async function onScroll(): Promise<void> {
    const el = scrollRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    atBottomRef.current = atBottom;
    setShowScrollBtn(!atBottom);
    if (atBottom) setNewCount(0);
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
          // Dedup by messageId: the page must not duplicate already shown
          // messages even if ranges overlapped (load/seed race).
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

  function scrollToBottom(): void {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }

  // Save the current scroll position to the stack before jumping to a message.
  function pushNavStack(): void {
    const el = scrollRef.current;
    if (!el) return;
    navStackRef.current.push(el.scrollTop);
    setShowBackBtn(true);
  }

  // Return to the previous position (pop from the stack).
  function goBack(): void {
    const el = scrollRef.current;
    const stack = navStackRef.current;
    if (!el || stack.length === 0) return;
    const prevTop = stack.pop()!;
    el.scrollTo({ top: prevTop, behavior: 'smooth' });
    if (stack.length === 0) setShowBackBtn(false);
  }

  // Common send path (text and/or images): the optimistic message is queued,
  // then pump() uploads blobs and sends strictly in order. Confirmation comes
  // via the WS echo and REST response by clientMessageId. Attachment att objects
  // are shared between queue and optimistic content: blobId lands in both.
  function enqueueSend(
    text: string,
    images: OutgoingImage[],
    link?: LinkAttachment,
    replyToMessageId?: string,
    media?: { att: AudioAttachment | VideoAttachment | FileAttachment; blob: Blob },
  ): void {
    const clientMessageId = crypto.randomUUID();
    const attachments: Attachment[] = [
      ...images.map((i) => i.att),
      ...(media ? [media.att] : []),
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
      viewCount: 0,
    };
    atBottomRef.current = true;
    setMessages((prev) => upsert(prev, optimistic));
    sendQueueRef.current.push({ clientMessageId, text, images, link, media, replyToMessageId });
    // Typing ended with a send — reset the typing throttle and flush timer.
    lastTypingSent.current = 0;
    if (typingFlushRef.current) {
      clearTimeout(typingFlushRef.current);
      typingFlushRef.current = null;
    }
    void pump();
  }

  // Sequential queue pump: for the head, first upload missing blobs, then send
  // the message; on success shift and continue; on failure (upload or send),
  // mark failed and STOP (the head blocks the queue until retried). A retry
  // reuses already uploaded blobs (blobId kept in att).
  // Single instance in flight (pumpingRef).
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
          if (head.media && !head.media.att.blobId) {
            const { blobId } = await uploadBlob(head.media.blob);
            head.media.att.blobId = blobId;
          }
          const content: MessageContent = {
            text: head.text,
            attachments: [
              ...head.images.map((i) => i.att),
              ...(head.media ? [head.media.att] : []),
              ...(head.link ? [head.link] : []),
            ],
          };
          // Propagate assigned blobIds into the optimistic message (so clicking
          // the preview opens full size even before the WS echo arrives).
          if (head.images.length || head.media) {
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
            [
              ...head.images.map((i) => i.att.blobId),
              ...(head.media && head.media.att.blobId ? [head.media.att.blobId] : []),
            ],
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
          break; // don't overtake the stuck head
        }
      }
    } finally {
      pumpingRef.current = false;
    }
  }

  // Retry: the head is still queued — just restart the pump.
  function retrySend(): void {
    void pump();
  }

  // --- Voice and video messages (#34) ---

  // Normalize the wave: relative scale to the max; no need to trim trailing
  // zeros — wave length matches recording time.
  function normalizeWave(wave: number[]): number[] {
    if (!wave.length) return new Array(1).fill(0.2);
    const max = Math.max(...wave, 0.01);
    return wave.map((v) => Math.max(0.06, Math.min(1, v / max)));
  }

  const recCancelRef = useRef(false);
  const recStartXRef = useRef(0);
  const pressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pressFiredRef = useRef(false);

  const voice = useVoiceRecorder(() => {
    // Auto-stop at the 5-minute limit — finish like a normal release.
    pressFiredRef.current = true;
    void finishVoice();
  });

  async function finishVoice(): Promise<void> {
    const rec: VoiceRecording | null = await voice.stop();
    setRecCancelArmed(false);
    if (!rec) return;
    // Swipe-cancel or accidental short tap — discard.
    if (recCancelRef.current || rec.duration < 0.7) return;
    const att: AudioAttachment = {
      kind: 'audio',
      blobId: '',
      mime: (rec.mime.split(';')[0] || 'audio/webm'),
      duration: Math.round(rec.duration * 10) / 10,
      wave: normalizeWave(rec.wave),
      size: rec.blob.size,
    };
    const replyId = replyTo;
    setReplyTo(null);
    enqueueSend('', [], undefined, replyId ?? undefined, { att, blob: rec.blob });
  }

  // Playlist (#34): when a voice message ends, play the next one in the chat.
  function playNextVoice(finishedMsgId: string | null): void {
    if (!finishedMsgId) return;
    const idx = messages.findIndex((m) => m.messageId === finishedMsgId);
    if (idx < 0) return;
    for (let i = idx + 1; i < messages.length; i++) {
      const att = messages[i].content.attachments.find(
        (a): a is AudioAttachment => a.kind === 'audio',
      );
      if (!att || !messages[i].messageId) continue;
      if (!att.blobId) continue; // still uploading — skip
      voiceRefs.current.get(messages[i].messageId!)?.play();
      return;
    }
  }

  async function onVideoRecorded(rec: VideoRecording): Promise<void> {
    setVideoRecKey(0);
    const { thumb, width, height } = await videoPosterFrame(rec.blob);
    const att: VideoAttachment = {
      kind: 'video',
      blobId: '',
      mime: rec.mime.split(';')[0] || 'video/webm',
      duration: Math.round(rec.duration * 10) / 10,
      width,
      height,
      size: rec.blob.size,
      thumb,
    };
    enqueueSend('', [], undefined, undefined, { att, blob: rec.blob });
  }

  // Hold-to-record: short click toggles mic/camera; hold ≥250ms records.
  // Pointer capture is required so pointermove/pointerup reach the button
  // when the cursor leaves it (swipe-to-cancel).
  function onMicPointerDown(e: React.PointerEvent<HTMLButtonElement>): void {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    pressFiredRef.current = false;
    recCancelRef.current = false;
    setRecCancelArmed(false);
    recStartXRef.current = e.clientX;
    pressTimerRef.current = setTimeout(() => {
      pressFiredRef.current = true;
      if (micMode === 'voice') void voice.start();
      else setVideoRecKey((k) => k + 1);
    }, 250);
  }

  function onMicPointerUp(): void {
    if (pressTimerRef.current) {
      clearTimeout(pressTimerRef.current);
      pressTimerRef.current = null;
    }
    if (!pressFiredRef.current) {
      setMicMode((m) => (m === 'voice' ? 'video' : 'voice'));
      return;
    }
    if (micMode === 'voice' && voice.state === 'recording') void finishVoice();
  }

  function onMicPointerMove(e: React.PointerEvent<HTMLButtonElement>): void {
    if (voice.state !== 'recording') return;
    const dx = e.clientX - recStartXRef.current;
    if (dx < -80 && !recCancelRef.current) {
      recCancelRef.current = true;
      setRecCancelArmed(true);
    } else if (dx >= -40 && recCancelRef.current) {
      recCancelRef.current = false;
      setRecCancelArmed(false);
    }
  }

  async function doSubmit(): Promise<void> {
    const text = (composerRef.current?.getMarkdown() ?? '').trim();
    if (!text) return;

    if (editing) {
      const messageId = editing;
      setEditing(null);
      setInput('');
      composerRef.current?.setMarkdown('');
      setFormatBarVisible(false);
      // optimistic + the message.edited event confirms (text-only edit)
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
        /* the event won't come — leave as is; no rollback in v1 */
      }
      return;
    }

    // Attach the link preview if ready and its URL is still in the text (#32).
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

  // Enter sends, Shift+Enter inserts a newline (issue #25). isComposing filters
  // out the Enter confirming IME input (CJK characters etc.).
  function onInputKeyDown(e: KeyboardEvent<HTMLDivElement>): void {
    if (e.key === 'Escape' && replyTo) {
      setReplyTo(null);
      return;
    }
    // Formatting shortcuts (#69)
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
    // @-mention popup navigation
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
    e.target.value = ''; // allow picking the same file again
    if (!file) return;
    // Images go through the editor; everything else is sent as a document (#85).
    if (file.type.startsWith('image/')) {
      setPendingImage(file);
    } else {
      sendFile(file);
    }
  }

  // Document sending (#85): straight into the queue with a file attachment.
  function sendFile(file: File): void {
    const att: FileAttachment = {
      kind: 'file',
      blobId: '',
      name: file.name,
      mime: file.type || 'application/octet-stream',
      size: file.size,
    };
    const replyId = replyTo;
    setReplyTo(null);
    enqueueSend('', [], undefined, replyId ?? undefined, { att, blob: file });
  }

  // Download a document (#85): fetch the blob with auth, then trigger save-as.
  async function downloadFile(name: string, blobId: string): Promise<void> {
    if (!blobId) return;
    try {
      const blob = await fetchBlob(blobId);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch {
      // Ignore download failures for now.
    }
  }

  // Paste image from clipboard (Ctrl/Cmd+V): if there's an image, open the same
  // editor as when attaching via 📎 (issue #17). While editing, no attachments —
  // fall through to plain text paste.
  function onPaste(e: ClipboardEvent<HTMLDivElement>): void {
    if (editing) return;
    const items = e.clipboardData?.items;
    if (!items) return;
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if (it.kind === 'file' && it.type.startsWith('image/')) {
        const file = it.getAsFile();
        if (file) {
          e.preventDefault(); // don't also paste accompanying text into the input
          setPendingImage(file);
          return;
        }
      }
    }
  }

  function startEdit(m: MsgVM): void {
    // Only plain-text messages (no attachments) are editable.
    if (!m.messageId || m.content.attachments.length > 0) return;
    setEditing(m.messageId);
    setInput(m.content.text);
  }

  // From the image editor: build the attachment with thumbnail and enqueue it
  // (the full blob uploads in pump). The caption lives on the attachment.
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
      /* idempotent; the message.deleted event will confirm */
    }
  }

  // Subtitle under the title: for groups "N members, M online",
  // for direct chats the peer's status. Self counts as online (we're connected).
  const onlineCount = chat.participants.filter(
    (p) => p.userId === myId || onlineUsers.has(p.userId),
  ).length;
  let subtitle: string | null = null;
  // Status kind drives the CSS coloring and must not depend on the locale (#58).
  let subtitleKind: '' | 'online' | 'away' = '';
  if (chat.type === 'group') {
    subtitle = pluralMembers(chat.participants.length);
    if (onlineCount > 0)
      subtitle += `, ${i18n.t('conv.onlineCount', { n: onlineCount })}`;
    subtitleKind = 'online';
  } else {
    const other = chat.participants.find((p) => p.userId !== myId);
    if (other) {
      if (onlineUsers.has(other.userId)) {
        subtitle = i18n.t('conv.online');
        subtitleKind = 'online';
      } else if (awayUsers.has(other.userId)) {
        subtitle = other.lastActiveAt
          ? `${i18n.t('conv.away')}. ${formatLastSeen(other.lastActiveAt)}`
          : i18n.t('conv.away');
        subtitleKind = 'away';
      } else if (other.lastActiveAt) {
        subtitle = formatLastSeen(other.lastActiveAt);
      } else {
        subtitle = i18n.t('conv.offline');
      }
    }
  }
  const isGroup = chat.type === 'group';
  // Sender name by id — to identify the author in groups (issue #21).
  const nameOf = (id: string): string =>
    chat.participants.find((p) => p.userId === id)?.username ?? '—';

  // Format the "typing" string with names (issue #35).
  // Returns text WITHOUT "..." — animated dots are added separately in JSX.
  const formatTypingText = (users: Map<string, string>): string => {
    const names = [...users.keys()]
      .map((id) => chat.participants.find((p) => p.userId === id)?.username)
      .filter((n): n is string => !!n);
    const typingP = ` ${i18n.t('conv.typingP')}`;
    if (names.length === 0) return i18n.t('conv.typing');
    const MAX_LEN = 40;
    if (names.length === 1) return `${names[0]} ${i18n.t('conv.typingS')}`;
    if (names.length === 2)
      return `${names[0]} ${i18n.t('conv.and')} ${names[1]}${typingP}`;
    // 3+ names: append one by one while it fits; otherwise "and others".
    let result = names[0];
    for (let i = 1; i < names.length; i++) {
      const candidate = `${result}, ${names[i]}`;
      if (candidate.length + typingP.length <= MAX_LEN) {
        result = candidate;
      } else {
        return `${result} ${i18n.t('conv.andOthers')}${typingP}`;
      }
    }
    return `${result}${typingP}`;
  };

  return (
    <div className={'conv' + (ctxMenu ? ' has-ctx-menu' : '') + (fullEmojiPickerMsgId ? ' has-emoji-picker' : '')} data-testid="conversation-open">
      <header className="conv-header">
        <button
          type="button"
          className="conv-back"
          data-testid="conv-back"
          aria-label={t('conv.backToList')}
          onClick={onBack}
        >
          <IconArrowLeft />
        </button>
        <button
          type="button"
          className="conv-headline conv-headline--clickable"
          data-testid="conv-header-info"
          onClick={() => {
            if (isGroup) setGroupInfoOpen(true);
            else {
              const other = chat.participants.find((p) => p.userId !== myId);
              if (other) onShowProfile(other.userId);
            }
          }}
        >
          {!isGroup && (() => {
            const other = chat.participants.find((p) => p.userId !== myId);
            return other ? (
              <span
                className="conv-header-avatar"
                style={{ backgroundColor: colorFor(other.username) }}
              >
                {initialFor(other.username)}
              </span>
            ) : null;
          })()}
          <span className="conv-headline-text">
            <span className="conv-title">{chatTitle(chat, myId)}</span>
            {subtitle && (
              <span
                className={
                  'conv-subtitle' +
                  (subtitleKind === 'online' ? ' conv-subtitle--online' :
                   subtitleKind === 'away' ? ' conv-subtitle--away' : '')
                }
                data-testid="conv-subtitle"
              >
                {subtitle}
              </span>
            )}
          </span>
        </button>
        {!isGroup && onCall && (() => {
          const other = chat.participants.find((p) => p.userId !== myId);
          return other ? (
            <span className="conv-call-actions">
              <button
                type="button"
                className="icon-button"
                aria-label={t('conv.audioCall')}
                data-testid="call-audio-btn"
                onClick={() => onCall(other.userId, false)}
              >
                <IconPhone />
              </button>
              <button
                type="button"
                className="icon-button"
                aria-label={t('conv.videoCall')}
                data-testid="call-video-btn"
                onClick={() => onCall(other.userId, true)}
              >
                <IconVideoCam />
              </button>
            </span>
          ) : null;
        })()}
        <button
          type="button"
          className="icon-button"
          aria-label={t('conv.chatMedia')}
          data-testid="gallery-btn"
          onClick={() => setGalleryOpen(true)}
        >
          <IconImage />
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
      {/* Pinned message bar (#86). */}
      {pinnedPreview && (
        <div className="conv-pin-bar" data-testid="pin-bar">
          <span className="conv-pin-icon">
            <IconPin />
          </span>
          <button
            type="button"
            className="conv-pin-body"
            data-testid="pin-jump"
            onClick={() => {
              const el = scrollRef.current;
              const target = el?.querySelector(
                `[data-message-id="${pinnedPreview.id}"]`,
              );
              if (!el || !target) return;
              pushNavStack();
              atBottomRef.current = false;
              el.scrollTo({
                top:
                  (target as HTMLElement).offsetTop -
                  el.offsetTop -
                  el.clientHeight / 2 +
                  (target as HTMLElement).clientHeight / 2,
                behavior: 'smooth',
              });
            }}
          >
            <span className="conv-pin-name">{pinnedPreview.name}</span>
            <span className="conv-pin-text">{pinnedPreview.text}</span>
          </button>
          <button
            type="button"
            className="conv-pin-unpin"
            aria-label={t('conv.unpin')}
            data-testid="pin-unpin"
            onClick={() => {
              void unpinMessage(chatId)
                .then((updated) => onChatUpdated(updated as Chat))
                .catch(() => undefined);
            }}
          >
            <IconX />
          </button>
        </div>
      )}
      <div
        className="conv-scroll"
        ref={scrollRef}
        onScroll={onScroll}
      >
        {loadingMore && <div className="conv-loading">{t('common.loading')}</div>}
        <div className="conv-messages" data-testid="messages">
          {(chat.username
            ? messages.filter((m) => !m.replyToMessageId)
            : messages
          ).map((m, i) => {
            const own = m.senderId === myId;
            const read =
              own && m.messageId ? Number(m.messageId) <= readUpTo : false;
            const prev = messages[i - 1];
            const next = messages[i + 1];
            // New calendar day — date divider before the message.
            const showDate = !prev || !sameDay(prev.ts, m.ts);
            // Group consecutive messages by the same author within a day:
            // tail only on the last in the group, top margin on the first.
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
                  (m.replyToMessageId && messages.some((x) => x.messageId === m.replyToMessageId && x.senderId === myId) ? ' bubble-reply-to-me' : '') +
                  (m.content.attachments.some((a) => a.kind === 'image') ? ' bubble--media' : '')
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
                    { label: t('conv.reply'), icon: <IconReply />, onClick: () => setReplyTo(m.messageId!) },
                    m.messageId && m.messageId === chat.pinnedMessageId
                      ? {
                          label: t('conv.unpin'),
                          icon: <IconPin />,
                          onClick: () => {
                            void unpinMessage(chatId)
                              .then((updated) => onChatUpdated(updated as Chat))
                              .catch(() => undefined);
                          },
                        }
                      : {
                          label: t('conv.pin'),
                          icon: <IconPin />,
                          onClick: () => {
                            if (!m.messageId) return;
                            void pinMessage(chatId, m.messageId)
                              .then((updated) => onChatUpdated(updated as Chat))
                              .catch(() => undefined);
                          },
                        },
                  ];
                  if (canEdit) {
                    items.push({ label: t('conv.edit'), icon: <IconEdit />, onClick: () => startEdit(m) });
                  }
                  if (onForward && !m.pending && !m.failed) {
                    items.push({ label: t('conv.forward'), icon: <IconForward />, onClick: () => onForward(m) });
                  }
                  items.push({ separator: true, label: '', onClick: () => {} });
                  items.push({ label: t('conv.copyText'), icon: <IconCopy />, onClick: () => {
                    // Strip markup: **, _, ~~, `
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
                    items.push({ label: t('common.delete'), icon: <IconTrash />, onClick: () => onDelete(m), danger: true });
                  }
                  setCtxMenu({ items, x: e.clientX, y: e.clientY });
                  setReactionPickerMsgId(m.messageId!);
                  setFullEmojiPickerMsgId(null);
                }}
              >
                {/* Swipe indicator: reply arrow while swiping right */}
                {swipeMsgId === m.messageId && swipeX > 20 && (
                  <span className="bubble-swipe-indicator" style={{ opacity: Math.min(1, (swipeX - 20) / 60) }}>
                    <IconReply />
                  </span>
                )}
                {/* Author avatar on the last bubble of a series (group, others) — #21 */}
                {isGroup && !own && groupEnd && (
                  <span
                    className="bubble-avatar"
                    aria-hidden="true"
                    style={{ background: colorFor(nameOf(m.senderId)) }}
                    onClick={() => onShowProfile(m.senderId)}
                  >
                    {initialFor(nameOf(m.senderId))}
                  </span>
                )}
                {/* Author name above the first bubble of a series (group, others) — #21 */}
                {isGroup && !own && groupStart && (
                  <span
                    className="bubble-sender"
                    data-testid="bubble-sender"
                    style={{ color: colorFor(nameOf(m.senderId)) }}
                    onClick={() => onShowProfile(m.senderId)}
                  >
                    {nameOf(m.senderId)}
                  </span>
                )}
                <span className="bubble-content">
                  {m.deleted ? (
                    <em>{t('conv.msgDeleted')}</em>
                  ) : (
                    <>
                      {/* Preview of the message being replied to (#33) */}
                      {m.replyToMessageId && (() => {
                        const ref = messages.find((x) => x.messageId === m.replyToMessageId);
                        const refName = ref
                          ? chat.participants.find((p) => p.userId === ref.senderId)?.username ?? '—'
                          : '';
                        const refText = ref
                          ? ref.deleted
                            ? t('conv.msgDeleted')
                            : ref.content.text.slice(0, 80)
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
                              pushNavStack();
                              // Reset atBottom so auto-scroll doesn't pull back down
                              atBottomRef.current = false;
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
                              // Message already visible — highlight right away
                              const rect = target.getBoundingClientRect();
                              const scrollRect = el.getBoundingClientRect();
                              if (rect.top >= scrollRect.top && rect.bottom <= scrollRect.bottom) {
                                doHighlight();
                              } else {
                                // Manual position math instead of scrollIntoView —
                                // on Android WebView scrollIntoView may scroll
                                // the wrong container.
                                const targetTop = (target as HTMLElement).offsetTop
                                  - el.offsetTop
                                  - el.clientHeight / 2
                                  + (target as HTMLElement).clientHeight / 2;
                                el.scrollTo({ top: targetTop, behavior: 'smooth' });
                                el.addEventListener('scrollend', () => doHighlight(), { once: true });
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
                      {m.content.fwd && (
                        <span className="bubble-fwd" data-testid="bubble-fwd">
                          {t('conv.fwdFrom', { name: m.content.fwd.from })}
                        </span>
                      )}
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
                              alt={a.caption || t('conv.imageAlt')}
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
                        ) : a.kind === 'sticker' ? (
                          <span className="bubble-sticker" key={ai}>
                            <StickerImage blobId={a.blobId} />
                          </span>
                        ) : a.kind === 'audio' ? (
                          <VoiceBubble
                            key={ai}
                            ref={(el) => {
                              if (m.messageId && el) voiceRefs.current.set(m.messageId, el);
                              else if (m.messageId) voiceRefs.current.delete(m.messageId);
                            }}
                            messageId={m.messageId ?? m.clientMessageId ?? ''}
                            att={a}
                            own={own}
                            onEnded={() => playNextVoice(m.messageId)}
                          />
                        ) : a.kind === 'video' ? (
                          <span
                            className="bubble-video"
                            key={ai}
                            data-testid="message-video"
                            onClick={() =>
                              a.blobId &&
                              setViewer({ blobId: a.blobId, caption: '', kind: 'video' })
                            }
                          >
                            {a.thumb ? (
                              <img src={`data:image/jpeg;base64,${a.thumb}`} alt={t('conv.videoAlt')} />
                            ) : (
                              <span className="bubble-video-placeholder" />
                            )}
                            <span className="bubble-video-play">
                              <IconPlay />
                            </span>
                            <span className="bubble-video-duration">{fmtSec(a.duration)}</span>
                          </span>
                        ) : a.kind === 'file' ? (
                          <button
                            type="button"
                            className="bubble-file"
                            key={ai}
                            data-testid="message-file"
                            onClick={() => downloadFile(a.name, a.blobId)}
                          >
                            <span className="bubble-file-icon">📎</span>
                            <span className="bubble-file-body">
                              <span className="bubble-file-name">{a.name}</span>
                              <span className="bubble-file-size">{fmtSize(a.size)}</span>
                            </span>
                          </button>
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
                    {/* Reactions on the left (#23) */}
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
                    {chat.username && m.viewCount > 0 && (
                      <span className="bubble-views">👁 {m.viewCount}</span>
                    )}
                    {/* Own message delivery status (#24/#26): sending —
                        spinner, failed — "!", sent — single check,
                        read — double blue. */}
                    {own &&
                      (m.failed ? (
                        <span
                          className="bubble-status is-failed"
                          data-testid="msg-status"
                          data-status="failed"
                          title={t('conv.notSent')}
                          aria-label={t('conv.notSent')}
                        >
                          <IconAlertCircle />
                        </span>
                      ) : m.pending ? (
                        <span
                          className="bubble-spinner"
                          data-testid="msg-status"
                          data-status="sending"
                          aria-label={t('conv.sending')}
                        />
                      ) : m.messageId ? (
                        <span
                          className={'bubble-status' + (read ? ' is-read' : '')}
                          data-testid="msg-status"
                          data-status={read ? 'read' : 'sent'}
                          aria-label={read ? t('conv.read') : t('conv.sent')}
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
                    {t('conv.retry')}
                  </button>
                )}
                {/* Action buttons: delete, edit, reply (#50) */}
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
                        title={t('conv.react')}
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
                          title={t('common.delete')}
                          onClick={() => onDelete(m)}
                        >
                          <IconTrash />
                        </button>
                      )}
                      {canEdit && (
                        <button
                          type="button"
                          data-testid="msg-edit"
                          title={t('conv.edit')}
                          onClick={() => startEdit(m)}
                        >
                          <IconEdit />
                        </button>
                      )}
                      {canReply && (
                        <button
                          type="button"
                          data-testid="msg-reply"
                          title={t('conv.reply')}
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
          {/* Draft bubble preview of the message being typed (#18 Live Draft) */}
          {typingUsers.size > 0 && (() => {
            // Show the draft from the first user who has text
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
                      <span className="bubble-draft-status">{t('conv.typingDots')}</span>
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
            title={t('conv.mentionsNav', {
              i: mentionNavIndex + 1,
              n: mentionMessages.length,
            })}
            onClick={jumpToNextMention}
          >
            @{mentionMessages.length}
          </button>
        )}
      </div>
      {showBackBtn && (
        <button
          type="button"
          className="nav-back-btn"
          data-testid="nav-back"
          title={t('conv.navBack')}
          onClick={goBack}
        >
          <IconRotateCcw />
        </button>
      )}
      {showScrollBtn && (
        <button
          type="button"
          className="scroll-to-bottom"
          data-testid="scroll-to-bottom"
          title={t('conv.toLast')}
          onClick={scrollToBottom}
        >
          <IconArrowDown />{newCount > 0 && <span className="scroll-to-bottom-badge">{newCount}</span>}
        </button>
      )}
      {editing && (
        <div className="conv-editing" data-testid="editing-banner">
          <span>{t('conv.editing')}</span>
          <button type="button" onClick={cancelEdit}>
            {t('common.cancel')}
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
            aria-label={t('conv.removePreview')}
            onClick={dismissPreview}
          >
            <IconX />
          </button>
        </div>
      )}
      {replyTo && (() => {
        const msg = messages.find((m) => m.messageId === replyTo);
        if (!msg) return null;
        const name = chat.participants.find((p) => p.userId === msg.senderId)?.username ?? '—';
        const preview = msg.deleted ? t('conv.msgDeleted') : msg.content.text.slice(0, 80);
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
              aria-label={t('conv.cancelReply')}
            >
              <IconX />
            </button>
          </div>
        );
      })()}
      <div className="conv-composer-wrap">
        {chat.role === 'non_member' ? (
          <div className="channel-subscribe-banner" data-testid="channel-subscribe-banner">
            <span>{t('conv.notSubscribed')}</span>
            <button
              type="button"
              className="btn btn-primary"
              onClick={async () => {
                await subscribeChannel(chat.chatId);
                onChatUpdated({ ...chat, role: 'subscriber', subscriberCount: chat.subscriberCount + 1 });
              }}
            >
              {t('conv.subscribe')}
            </button>
          </div>
        ) : (<>
        {/* Voice recording bar (#34): timer + live waveform. */}
        {voice.state === 'recording' && (
          <div className="conv-rec-bar" data-testid="rec-bar">
            <span className="conv-rec-dot" />
            <span className="conv-rec-timer" data-testid="rec-timer">{fmtSec(voice.seconds)}</span>
            <div className="conv-rec-wave">
              {voice.levels.map((l, i) => (
                <span key={i} style={{ height: `${Math.max(3, Math.round(l * 22))}px` }} />
              ))}
            </div>
            <span className={'conv-rec-hint' + (recCancelArmed ? ' armed' : '')} data-testid="rec-hint">
              {recCancelArmed
                ? t('conv.recCancelArmed')
                : t('conv.recCancelHint')}
            </span>
          </div>
        )}
        <FormattingToolbar
          visible={formatBarVisible}
          onBold={onBold}
          onItalic={onItalic}
          onStrike={onStrike}
          onCode={onCode}
          onLink={onLink}
        />
        {/* Hide input for channel subscribers — they can only read. */}
        {!(chat.username && chat.role !== 'owner' && chat.role !== 'admin') && (
        <form className="conv-input" onSubmit={onSubmit}>
          <input
            ref={fileInputRef}
            type="file"
            accept="*/*"
            hidden
            data-testid="image-input"
            onChange={onPickFile}
          />
          <div className="conv-input-field">
          <button
            type="button"
            className="conv-attach"
            data-testid="attach-image"
            aria-label={t('conv.attachImage')}
            disabled={!!editing}
            onClick={() => fileInputRef.current?.click()}
          >
            <IconAttach />
          </button>
          <button
            type="button"
            className="conv-emoji-btn"
            data-testid="emoji-btn"
            aria-label={t('conv.emojiStickers')}
            onPointerDown={(e) => {
              e.preventDefault();
              const sel = window.getSelection();
              if (sel && sel.rangeCount > 0) {
                savedRangeRef.current = sel.getRangeAt(0).cloneRange();
              }
              setMediaOpen(!mediaOpen);
            }}
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
            onBlur={() => { setFormatBarVisible(false); setSelection(null); }}
            divRef={inputRef}
            usernames={new Set(chat.participants.map((p) => p.username))}
            data-testid="message-input"
          />
        </div>
        {input.trim() || editing ? (
          <button
            type="submit"
            className="conv-send"
            data-testid="message-send"
            aria-label={editing ? t('common.save') : t('conv.send')}
          >
            <IconSend />
          </button>
        ) : (
          <button
            type="button"
            className={'conv-mic-btn' + (voice.state === 'recording' ? ' is-recording' : '')}
            data-testid="mic-btn"
            aria-label={
              micMode === 'voice'
                ? t('conv.voiceRecHint')
                : t('conv.videoRecHint')
            }
            onPointerDown={onMicPointerDown}
            onPointerUp={onMicPointerUp}
            onPointerMove={onMicPointerMove}
            onContextMenu={(e) => e.preventDefault()}
          >
            <span className="conv-mic-icon">{micMode === 'voice' ? <IconMic /> : <IconCamera />}</span>
          </button>
        )}
        {mediaOpen && (
          <MediaPanel
            onSelectEmoji={(emoji) => {
              const el = inputRef.current;
              if (el) {
                el.focus();
                const saved = savedRangeRef.current;
                if (saved) {
                  const sel = window.getSelection();
                  if (sel) {
                    sel.removeAllRanges();
                    sel.addRange(saved);
                  }
                }
                document.execCommand('insertText', false, emoji);
              } else {
                setInput(input + emoji);
              }
            }}
            onSelectSticker={async (blobId) => {
              const clientMessageId = crypto.randomUUID();
              const content = { text: '', attachments: [{ kind: 'sticker' as const, blobId }] };
              try {
                const res = await sendMessage(
                  chatId,
                  clientMessageId,
                  encodeContent(content),
                  [blobId],
                );
                setMessages((prev) =>
                  upsert(prev, {
                    clientMessageId,
                    senderId: myIdRef.current ?? '',
                    messageId: res.messageId,
                    ts: res.ts,
                    content,
                    pending: false,
                    failed: false,
                  }),
                );
              } catch {
                // send failed
              }
            }}
            onClose={() => setMediaOpen(false)}
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
      )}
      </>)}
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
      {videoRecKey > 0 && (
        <VideoRecorderModal
          key={videoRecKey}
          onSend={(rec) => void onVideoRecorded(rec)}
          onClose={() => setVideoRecKey(0)}
          onReRecord={() => setVideoRecKey((k) => k + 1)}
        />
      )}
      {galleryOpen && (
        <MediaGallery
          chatId={chatId}
          onClose={() => setGalleryOpen(false)}
          onOpen={(item) => {
            const att = item.att as { k?: string; blob?: string };
            if (!att.blob) return;
            setGalleryOpen(false);
            setViewer({
              blobId: att.blob,
              caption: '',
              kind: att.k === 'video' ? 'video' : 'image',
            });
          }}
        />
      )}
      {viewer && (
        <MediaViewer
          blobId={viewer.blobId}
          caption={viewer.caption}
          kind={viewer.kind}
          onClose={() => setViewer(null)}
        />
      )}
      {groupInfoOpen && chat.username && (
        <ChannelInfoDialog
          chat={chat}
          myId={myId}
          onClose={() => setGroupInfoOpen(false)}
          onUpdated={(updated) => { onChatUpdated(updated); }}
          onRemoved={(chatId) => { onChatRemoved(chatId); }}
        />
      )}
      {groupInfoOpen && !chat.username && (
        <GroupInfoDialog
          chat={chat}
          myId={myId}
          onOpenMembers={() => { setGroupInfoOpen(false); setMembersOpen(true); }}
          onClose={() => setGroupInfoOpen(false)}
          onUpdated={(updated) => { onChatUpdated(updated); }}
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
          onShowProfile={onShowProfile}
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
      {/* Full emoji picker (from the arrow in the reaction bar) */}
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
      {/* Link input dialog (#69) */}
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

// Quick reaction bar — inside the context menu (#23, like Telegram).
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
  const { t } = useTranslation();
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
        title={t('common.more')}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
    </div>
  );
}

// EmojiPicker with on-screen position correction (#23).
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

// Component rendering a sticker by blobId
function StickerImage({ blobId }: { blobId: string }): JSX.Element {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchBlob(blobId).then((blob) => {
      if (!cancelled) setUrl(URL.createObjectURL(blob));
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [blobId]);

  if (!url) return <span className="sticker-loading" />;
  return <img src={url} className="sticker-img" alt={i18n.t('conv.stickerAlt')} />;
}
