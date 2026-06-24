// Типы контракта сервера (см. doc/api.md). Здесь — минимум, нужный клиенту;
// расширяется по мере появления экранов.

export interface AuthResult {
  userId: string;
  username?: string; // приходит при регистрации; при логине — нет
  accessToken: string;
}

export interface DeviceInfo {
  deviceId: string;
  createdAt: string;
  lastSeenAt: string | null;
}

export interface Me {
  userId: string;
  username: string;
  devices: DeviceInfo[];
}

export interface Participant {
  userId: string;
  username: string;
}

export interface MessagePreview {
  messageId: string;
  senderId: string;
  ciphertext: string; // base64
  ts: string;
}

export interface Chat {
  chatId: string;
  type: 'direct' | 'group';
  title: string | null;
  participants: Participant[];
  lastMessage: MessagePreview | null;
  unreadCount: number;
  updatedAt: string;
}

export interface Message {
  messageId: string;
  senderId: string;
  ciphertext: string; // base64
  ts: string;
  editedAt: string | null;
  deleted: boolean;
}

// Конверт события из потока WS. payload зависит от type (см. doc/api.md).
// seq есть у событий из outbox; у транзиентных (typing) его нет.
export interface ServerEvent {
  type: string;
  seq?: number;
  chatId?: string;
  ts: string;
  payload: Record<string, unknown>;
}
