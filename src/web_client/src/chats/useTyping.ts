import { useEffect, useRef, useState } from 'react';
import type { WsClient } from '../api/ws';
import type { ServerEvent } from '../api/types';

// Сколько держать индикатор «печатает» после последнего события typing (как в
// Conversation): источник транзиентный, без явного «перестал печатать».
const TYPING_HIDE_MS = 6000;

// Кто сейчас печатает, по чатам: chatId → множество userId. Источник —
// транзиентные события 'typing' из WS (без seq, не из outbox). Один источник на
// всё приложение (задача #27): и список чатов, и заголовок переписки, и окно
// участников читают отсюда. Себя не учитываем (своё «печатает» не показываем).
export function useTyping(
  ws: WsClient,
  myId: string | null,
): Map<string, Set<string>> {
  const [typingByChat, setTypingByChat] = useState<Map<string, Set<string>>>(
    () => new Map(),
  );
  const timers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  useEffect(() => {
    const drop = (chatId: string, userId: string): void =>
      setTypingByChat((prev) => {
        const set = prev.get(chatId);
        if (!set || !set.has(userId)) return prev;
        const next = new Map(prev);
        const ns = new Set(set);
        ns.delete(userId);
        if (ns.size) next.set(chatId, ns);
        else next.delete(chatId);
        return next;
      });

    const clear = (chatId: string, userId: string): void => {
      const key = `${chatId}|${userId}`;
      const t = timers.current.get(key);
      if (t) {
        clearTimeout(t);
        timers.current.delete(key);
      }
      drop(chatId, userId);
    };

    const offTyping = ws.on('typing', (ev: ServerEvent) => {
      const chatId = ev.chatId;
      const userId = (ev.payload as { userId?: string }).userId;
      if (!chatId || !userId || userId === myId) return;
      const key = `${chatId}|${userId}`;
      const existing = timers.current.get(key);
      if (existing) clearTimeout(existing);
      timers.current.set(
        key,
        setTimeout(() => {
          timers.current.delete(key);
          drop(chatId, userId);
        }, TYPING_HIDE_MS),
      );
      setTypingByChat((prev) => {
        const next = new Map(prev);
        const ns = new Set(prev.get(chatId));
        ns.add(userId);
        next.set(chatId, ns);
        return next;
      });
    });

    // Прислал сообщение — набор завершён: гасим «печатает» немедленно, не ждём
    // таймаута (как в Telegram: пришло сообщение — индикатор пропал).
    const offMessage = ws.on('message.new', (ev: ServerEvent) => {
      const chatId = ev.chatId;
      const senderId = (ev.payload as { senderId?: string }).senderId;
      if (!chatId || !senderId || senderId === myId) return;
      clear(chatId, senderId);
    });

    // Ушёл офлайн — печатать уже не может: гасим индикатор сразу, не дожидаясь
    // 6-секундного таймера (иначе «печатает» зависнет после закрытия вкладки).
    const offPresence = ws.on('presence', (ev: ServerEvent) => {
      const p = ev.payload as { userId?: string; online?: boolean };
      if (p.online || !p.userId) return;
      const userId = p.userId;
      for (const key of [...timers.current.keys()]) {
        if (key.endsWith(`|${userId}`)) {
          clearTimeout(timers.current.get(key)!);
          timers.current.delete(key);
        }
      }
      setTypingByChat((prev) => {
        let changed = false;
        const next = new Map(prev);
        for (const [chatId, set] of prev) {
          if (!set.has(userId)) continue;
          const ns = new Set(set);
          ns.delete(userId);
          if (ns.size) next.set(chatId, ns);
          else next.delete(chatId);
          changed = true;
        }
        return changed ? next : prev;
      });
    });

    const live = timers.current;
    return () => {
      offTyping();
      offMessage();
      offPresence();
      for (const t of live.values()) clearTimeout(t);
      live.clear();
    };
  }, [ws, myId]);

  return typingByChat;
}
