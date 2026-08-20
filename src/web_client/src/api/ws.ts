import { wsUrl } from './config';
import { getDeviceId } from './session';
import type { ServerEvent } from './types';

type Handler = (ev: ServerEvent) => void;

// Single event channel client (see architecture.md): one WS connection per
// device, resume via hello/lastSeq, auto-reconnect with growing backoff.
// Actions (sending messages etc.) go over REST — here we only receive events
// and ephemeral typing/read.
export class WsClient {
  private ws: WebSocket | null = null;
  private lastSeq: number;
  private closedByUser = false;
  private backoff = 1000;
  // false on (re)connect, true after the 'synced' marker — separates history
  // replay from live events (see architecture.md).
  private live = false;
  // Replay event buffer (before 'synced'). The server sends each event as a
  // separate WS frame, i.e. a separate onmessage → a separate setState in
  // subscribers → a separate re-render. On cold start / reconnect with a long
  // history this makes the list "flicker" through dozens of redraws. We collect
  // the replay and apply it as one synchronous batch on 'synced' — React 18
  // batches it into a single re-render.
  private replayBuffer: ServerEvent[] = [];
  private readonly handlers = new Map<string, Set<Handler>>();
  private readonly anyHandlers = new Set<Handler>();

  // onSeqAdvance is called when lastSeq advances — the owner (HomeScreen)
  // persists the cursor between sessions so reconnect/reload doesn't replay
  // everything from scratch.
  constructor(
    private readonly token: string,
    lastSeq = 0,
    private readonly onSeqAdvance?: (seq: number) => void,
  ) {
    this.lastSeq = lastSeq;
  }

  connect(): void {
    this.closedByUser = false;
    this.live = false;
    this.replayBuffer = [];
    // Detach the previous socket: its "late" messages (buffered replay,
    // 'synced') must not corrupt the shared live/lastSeq state of the new
    // connection — otherwise the new socket's replay would be treated as live
    // (double-counting unread). Relevant on reconnect and StrictMode double-effect.
    this.detach(this.ws);
    const ws = new WebSocket(wsUrl());
    this.ws = ws;

    ws.onopen = () => {
      if (this.ws !== ws) return;
      this.backoff = 1000;
      // hello with the last known seq — the server replays everything missed.
      ws.send(
        JSON.stringify({
          type: 'hello',
          token: this.token,
          lastSeq: this.lastSeq,
          deviceId: getDeviceId(),
        }),
      );
    };

    ws.onmessage = (e) => {
      if (this.ws !== ws) return; // ignore the superseded socket
      let ev: ServerEvent;
      try {
        ev = JSON.parse(typeof e.data === 'string' ? e.data : '');
      } catch {
        return;
      }
      this.dispatch(ev);
    };

    ws.onclose = () => {
      if (this.ws !== ws) return;
      if (!this.closedByUser) this.scheduleReconnect();
    };
    ws.onerror = () => {
      if (this.ws === ws) ws.close();
    };
  }

  // Removes handlers and closes the socket so its further events don't affect
  // the shared client state.
  private detach(ws: WebSocket | null): void {
    if (!ws) return;
    ws.onopen = ws.onmessage = ws.onclose = ws.onerror = null;
    try {
      ws.close();
    } catch {
      /* already closed */
    }
  }

  private dispatch(ev: ServerEvent): void {
    if (ev.type === 'synced') {
      // End of replay. Apply the accumulated buffer as one synchronous batch
      // (live is still false — subscribers treat it as history), then enable
      // live and emit the marker itself. The whole batch renders in one re-render.
      const buffered = this.replayBuffer;
      this.replayBuffer = [];
      for (const e of buffered) this.emit(e);
      this.live = true;
      this.emit(ev);
      return;
    }
    // Before 'synced', anything from the outbox is replay: buffer it, don't apply.
    if (!this.live) {
      this.replayBuffer.push(ev);
      return;
    }
    this.emit(ev);
  }

  // Applies one event: advance the cursor + notify subscribers.
  private emit(ev: ServerEvent): void {
    // Advance the cursor only for outbox events (transient ones have no seq).
    if (typeof ev.seq === 'number' && ev.seq > this.lastSeq) {
      this.lastSeq = ev.seq;
      this.onSeqAdvance?.(this.lastSeq);
    }
    const set = this.handlers.get(ev.type);
    if (set) for (const h of set) h(ev);
    for (const h of this.anyHandlers) h(ev);
  }

  private scheduleReconnect(): void {
    const delay = this.backoff;
    this.backoff = Math.min(this.backoff * 2, 15_000);
    setTimeout(() => {
      if (!this.closedByUser) this.connect();
    }, delay);
  }

  // Subscribe to a specific event type. Returns an unsubscribe function.
  on(type: string, handler: Handler): () => void {
    let set = this.handlers.get(type);
    if (!set) {
      set = new Set();
      this.handlers.set(type, set);
    }
    set.add(handler);
    return () => set!.delete(handler);
  }

  onAny(handler: Handler): () => void {
    this.anyHandlers.add(handler);
    return () => this.anyHandlers.delete(handler);
  }

  // Whether the end of the replay has been reached ('synced' received). Before
  // that all events are historical outbox dump, not what's happening now.
  isLive(): boolean {
    return this.live;
  }

  sendTyping(chatId: string, draft?: string): void {
    this.send({ type: 'typing', chatId, draft: draft || undefined });
  }

  sendRead(chatId: string, upToMessageId: string): void {
    this.send({ type: 'read', chatId, upToMessageId });
  }

  // Call signaling (#81): opaque payload (offer/answer/ice/hangup) to a peer.
  sendCallSignal(toUserId: string, data: Record<string, unknown>): void {
    this.send({ type: 'call', to: toUserId, data });
  }

  private send(obj: unknown): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(obj));
    }
  }

  close(): void {
    this.closedByUser = true;
    this.ws?.close();
  }

  /** Reconnect from outside (e.g. after returning from background on Android). */
  reconnect(): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      // Already connected — nothing to do
      return;
    }
    this.closedByUser = false;
    this.connect();
  }
}
