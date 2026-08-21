// Server contract types (see doc/api.md). Only the minimum the client needs;
// extended as new screens appear.

export interface AuthResult {
  userId: string;
  username?: string; // present on registration; absent on login
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
  role?: string;
  lastActiveAt?: string;
}

// Member in the list dialog: username plus online status at request time.
export interface ChatMember {
  userId: string;
  username: string;
  online: boolean;
  away?: boolean;
  lastActiveAt?: string;
}

export interface ChatMembers {
  createdBy: string | null;
  members: ChatMember[];
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
  description: string;
  createdBy: string | null;
  username: string | null;
  role: string;
  subscriberCount: number;
  pinnedMessageId: string | null;
  participants: Participant[];
  lastMessage: MessagePreview | null;
  unreadCount: number;
  unreadMentions: number;
  peerReadUpTo: string;
  updatedAt: string;
}

export interface Message {
  messageId: string;
  senderId: string;
  ciphertext: string; // base64
  ts: string;
  editedAt: string | null;
  deleted: boolean;
  replyToMessageId: string | null;
  viewCount: number;
  reactions?: ReactionGroup[];
}

export interface ReactionGroup {
  emoji: string;
  users: string[];
  count: number;
}

// Event envelope from the WS stream. payload depends on type (see doc/api.md).
// Outbox events carry seq; transient ones (typing) don't.
export interface ServerEvent {
  type: string;
  seq?: number;
  chatId?: string;
  ts: string;
  payload: Record<string, unknown>;
}

// ---- User profiles (#22) ----

export interface UserProfile {
  userId: string;
  username: string;
  createdAt: string;
  lastActiveAt: string | null;
}

export interface UserNote {
  text: string;
  createdAt: string;
  updatedAt: string;
}

// ---- Stickers (#63) ----

export interface StickerPack {
  packId: string;
  title: string;
  itemCount: number;
  coverBlobId: string | null;
  author?: string;
  createdAt: string;
}

export interface StickerItem {
  itemId: string;
  blobId: string;
  position: number;
  emoji: string | null;
}
