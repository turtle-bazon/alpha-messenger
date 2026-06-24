import { wsUrl } from './config';
import type { ServerEvent } from './types';

type Handler = (ev: ServerEvent) => void;

// Клиент единого канала событий (см. architecture.md): одно WS-соединение на
// устройство, resume через hello/lastSeq, авто-reconnect с нарастающей паузой.
// Действия (отправка сообщений и т.п.) идут по REST — здесь только приём событий
// и эфемерные typing/read.
export class WsClient {
  private ws: WebSocket | null = null;
  private lastSeq: number;
  private closedByUser = false;
  private backoff = 1000;
  // false на (ре)коннекте, true после маркера 'synced' — отделяет реплей
  // истории от живых событий (см. architecture.md).
  private live = false;
  private readonly handlers = new Map<string, Set<Handler>>();
  private readonly anyHandlers = new Set<Handler>();

  constructor(
    private readonly token: string,
    lastSeq = 0,
  ) {
    this.lastSeq = lastSeq;
  }

  connect(): void {
    this.closedByUser = false;
    this.live = false;
    const ws = new WebSocket(wsUrl());
    this.ws = ws;

    ws.onopen = () => {
      this.backoff = 1000;
      // hello с последним известным seq — сервер реплеит всё, что пропустили.
      ws.send(
        JSON.stringify({
          type: 'hello',
          token: this.token,
          lastSeq: this.lastSeq,
        }),
      );
    };

    ws.onmessage = (e) => {
      let ev: ServerEvent;
      try {
        ev = JSON.parse(typeof e.data === 'string' ? e.data : '');
      } catch {
        return;
      }
      this.dispatch(ev);
    };

    ws.onclose = () => {
      if (!this.closedByUser) this.scheduleReconnect();
    };
    ws.onerror = () => ws.close();
  }

  private dispatch(ev: ServerEvent): void {
    // Маркер окончания реплея: дальше идут живые события.
    if (ev.type === 'synced') this.live = true;
    // Двигаем курсор только по событиям из outbox (у транзиентных seq нет).
    if (typeof ev.seq === 'number' && ev.seq > this.lastSeq) {
      this.lastSeq = ev.seq;
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

  // Подписка на конкретный тип события. Возвращает функцию отписки.
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

  // Дошли ли до конца реплея (получен 'synced'). До этого все события —
  // историческая выгрузка outbox, а не происходящее сейчас.
  isLive(): boolean {
    return this.live;
  }

  sendTyping(chatId: string): void {
    this.send({ type: 'typing', chatId });
  }

  sendRead(chatId: string, upToMessageId: string): void {
    this.send({ type: 'read', chatId, upToMessageId });
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
}
