import { useEffect, useRef, useState } from 'react';
import type { WsClient } from '../api/ws';
import type { ServerEvent } from '../api/types';

// How long to keep the "typing" indicator after the last typing event (as in
// Conversation): the source is transient, with no explicit "stopped typing".
const TYPING_HIDE_MS = 6000;

// Who is currently typing, per chat: chatId → Map<userId, draft>. Source:
// transient 'typing' events from WS (no seq, not from outbox). A single source
// for the whole app (#27): the chat list, the conversation header, and the
// members dialog all read from here. Self is excluded (we don't show our own typing).
export function useTyping(
  ws: WsClient,
  myId: string | null,
): Map<string, Map<string, string>> {
  const [typingByChat, setTypingByChat] = useState<Map<string, Map<string, string>>>(
    () => new Map(),
  );
  const timers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  useEffect(() => {
    const drop = (chatId: string, userId: string): void =>
      setTypingByChat((prev) => {
        const map = prev.get(chatId);
        if (!map || !map.has(userId)) return prev;
        const next = new Map(prev);
        const nm = new Map(map);
        nm.delete(userId);
        if (nm.size) next.set(chatId, nm);
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
      const payload = ev.payload as { userId?: string; draft?: string };
      const userId = payload.userId;
      const draft = payload.draft;
      if (!chatId || !userId || userId === myId) return;
      const key = `${chatId}|${userId}`;
      const existing = timers.current.get(key);
      if (existing) clearTimeout(existing);

      // Empty draft means the user stopped typing
      if (!draft) {
        timers.current.delete(key);
        drop(chatId, userId);
        return;
      }

      timers.current.set(
        key,
        setTimeout(() => {
          timers.current.delete(key);
          drop(chatId, userId);
        }, TYPING_HIDE_MS),
      );
      setTypingByChat((prev) => {
        const next = new Map(prev);
        const nm = new Map(prev.get(chatId));
        nm.set(userId, draft);
        next.set(chatId, nm);
        return next;
      });
    });

    // Message sent — typing is over: hide the indicator immediately instead of
    // waiting for the timeout (like Telegram: message arrives, indicator disappears).
    const offMessage = ws.on('message.new', (ev: ServerEvent) => {
      const chatId = ev.chatId;
      const senderId = (ev.payload as { senderId?: string }).senderId;
      if (!chatId || !senderId || senderId === myId) return;
      clear(chatId, senderId);
    });

    // Went offline — can't be typing anymore: hide the indicator right away instead
    // of waiting for the 6-second timer (otherwise "typing" would hang after tab close).
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
        for (const [chatId, map] of prev) {
          if (!map.has(userId)) continue;
          const nm = new Map(map);
          nm.delete(userId);
          if (nm.size) next.set(chatId, nm);
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
