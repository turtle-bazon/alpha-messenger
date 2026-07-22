import { wsUrl } from './config';
import { getDeviceId } from './session';
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
  // Буфер событий реплея (до 'synced'). Сервер шлёт каждое событие отдельным
  // WS-кадром, т.е. отдельным onmessage → отдельный setState у подписчиков →
  // отдельный ререндер. На холодном старте/реконнекте с большой историей это
  // даёт «мигание» списка из десятков перерисовок. Копим реплей и применяем
  // одним синхронным пакетом на 'synced' — React 18 батчит его в один ререндер.
  private replayBuffer: ServerEvent[] = [];
  private readonly handlers = new Map<string, Set<Handler>>();
  private readonly anyHandlers = new Set<Handler>();

  // onSeqAdvance вызывается при продвижении lastSeq — владелец (HomeScreen)
  // сохраняет курсор между сессиями, чтобы reconnect/reload не реплеил всё с нуля.
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
    // Отвязываем предыдущий сокет: его «поздние» сообщения (буферизованный
    // реплей, 'synced') не должны портить общее состояние live/lastSeq нового
    // соединения — иначе реплей нового сокета принимается за live (двойной счёт
    // непрочитанного). Актуально при reconnect и StrictMode-двойном эффекте.
    this.detach(this.ws);
    const ws = new WebSocket(wsUrl());
    this.ws = ws;

    ws.onopen = () => {
      if (this.ws !== ws) return;
      this.backoff = 1000;
      // hello с последним известным seq — сервер реплеит всё, что пропустили.
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
      if (this.ws !== ws) return; // игнорируем вытесненный сокет
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

  // Снимает обработчики и закрывает сокет, чтобы его дальнейшие события не влияли
  // на общее состояние клиента.
  private detach(ws: WebSocket | null): void {
    if (!ws) return;
    ws.onopen = ws.onmessage = ws.onclose = ws.onerror = null;
    try {
      ws.close();
    } catch {
      /* уже закрыт */
    }
  }

  private dispatch(ev: ServerEvent): void {
    if (ev.type === 'synced') {
      // Конец реплея. Применяем накопленный буфер одним синхронным пакетом
      // (живость ещё false — подписчики трактуют его как историю), затем
      // включаем live и отдаём сам маркер. Весь пакет батчится в один ререндер.
      const buffered = this.replayBuffer;
      this.replayBuffer = [];
      for (const e of buffered) this.emit(e);
      this.live = true;
      this.emit(ev);
      return;
    }
    // До 'synced' всё, что пришло из outbox, — это реплей: копим, не применяем.
    if (!this.live) {
      this.replayBuffer.push(ev);
      return;
    }
    this.emit(ev);
  }

  // Применение одного события: продвижение курсора + вызов подписчиков.
  private emit(ev: ServerEvent): void {
    // Двигаем курсор только по событиям из outbox (у транзиентных seq нет).
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

  sendTyping(chatId: string, draft?: string): void {
    this.send({ type: 'typing', chatId, draft: draft || undefined });
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
