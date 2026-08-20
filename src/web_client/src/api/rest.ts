import { apiUrl } from './config';
import { getToken } from './session';
import type {
  AuthResult, Chat, ChatMembers, Me, Message, ReactionGroup,
  UserProfile, UserNote, StickerPack, StickerItem,
} from './types';

// Error with HTTP status and parsed body — screens distinguish 400/404/409 etc.
export class ApiError extends Error {
  constructor(
    public status: number,
    public body: unknown,
  ) {
    super(`api ${status}`);
    this.name = 'ApiError';
  }
}

interface RequestOptions {
  body?: unknown;
  auth?: boolean; // add Authorization: Bearer <token>
}

async function request<T>(
  method: string,
  path: string,
  opts: RequestOptions = {},
): Promise<T> {
  const headers: Record<string, string> = {};
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  if (opts.auth) {
    const token = getToken();
    if (token) headers['authorization'] = `Bearer ${token}`;
  }
  const res = await fetch(apiUrl(path), {
    method,
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new ApiError(res.status, data);
  return data as T;
}

export const rest = {
  get: <T>(path: string, auth = true) => request<T>('GET', path, { auth }),
  post: <T>(path: string, body?: unknown, auth = true) =>
    request<T>('POST', path, { body, auth }),
  put: <T>(path: string, body?: unknown, auth = true) =>
    request<T>('PUT', path, { body, auth }),
  patch: <T>(path: string, body?: unknown, auth = true) =>
    request<T>('PATCH', path, { body, auth }),
  del: <T>(path: string, auth = true) => request<T>('DELETE', path, { auth }),
};

// ---- Authentication ----

export function register(input: {
  username: string;
  password: string;
  invite: string;
  deviceId: string;
}): Promise<AuthResult> {
  return rest.post<AuthResult>('/auth/register', input, false);
}

export function login(input: {
  username: string;
  password: string;
  deviceId: string;
}): Promise<AuthResult> {
  return rest.post<AuthResult>('/auth/login', input, false);
}

export function getMe(): Promise<Me> {
  return rest.get<Me>('/me');
}

// ---- Chats ----

export async function getChats(): Promise<Chat[]> {
  const res = await rest.get<{ chats: Chat[] }>('/chats');
  return res.chats;
}

// Create a direct chat by the peer's username. The server deduplicates: returns
// the existing chat (200) or creates a new one (201) — the client receives the chat object.
export function createDirect(username: string): Promise<Chat> {
  return rest.post<Chat>('/chats', { type: 'direct', username });
}

// Create a group: title + member list by username (no need to include yourself
// — the server adds the creator automatically). Returns the chat object.
export function createGroup(title: string, members: string[]): Promise<Chat> {
  return rest.post<Chat>('/chats', { type: 'group', title, members });
}

export function getChat(chatId: string): Promise<Chat> {
  return rest.get<Chat>(`/chats/${chatId}`);
}

export function updateChat(
  chatId: string,
  data: { title?: string; description?: string },
): Promise<Chat> {
  return rest.patch<Chat>(`/chats/${chatId}`, data);
}

// Chat member list with online flags and creator indication.
export function getMembers(chatId: string): Promise<ChatMembers> {
  return rest.get<ChatMembers>(`/chats/${chatId}/members`);
}

// Add a member to a group by username (only the chat creator may do this).
export function addMember(
  chatId: string,
  username: string,
): Promise<{ chatId: string; userId: string }> {
  return rest.post(`/chats/${chatId}/members`, { username });
}

// Remove a member from a group (only the chat creator may do this).
export function removeMember(
  chatId: string,
  userId: string,
): Promise<{ chatId: string; userId: string }> {
  return rest.del(`/chats/${chatId}/members/${userId}`);
}

// Snapshot of members' online state for seeding presence after connect.
export interface PresenceInfo {
  online: boolean;
  away: boolean;
  lastActiveAt?: string;
}

export function getPresence(): Promise<{ presence: Record<string, PresenceInfo> }> {
  return rest.get<{ presence: Record<string, PresenceInfo> }>('/presence');
}

// ---- Messages ----

export interface MessagesPage {
  messages: Message[]; // newest first (DESC)
  hasMore: boolean;
  nextBefore: string | null;
}

export function getMessages(
  chatId: string,
  opts: { before?: string; limit?: number } = {},
): Promise<MessagesPage> {
  const params = new URLSearchParams();
  if (opts.before) params.set('before', opts.before);
  if (opts.limit) params.set('limit', String(opts.limit));
  const qs = params.toString();
  return rest.get<MessagesPage>(`/chats/${chatId}/messages${qs ? `?${qs}` : ''}`);
}

export interface SendResult {
  messageId: string;
  clientMessageId: string;
  ts: string;
  replyToMessageId: string | null;
}

// Media gallery of a chat (#82): image/video attachments from history.
export interface MediaItem {
  messageId: string;
  ts: string;
  // Raw attachment envelope (k:'image'|'video' with thumb/duration inside).
  att: Record<string, unknown>;
}

export interface MediaPage {
  items: MediaItem[];
  hasMore: boolean;
  nextBefore: string | null;
}

export function getChatMedia(
  chatId: string,
  opts: { before?: string; limit?: number } = {},
): Promise<MediaPage> {
  const params = new URLSearchParams();
  if (opts.before) params.set('before', opts.before);
  if (opts.limit) params.set('limit', String(opts.limit));
  const qs = params.toString();
  return rest.get<MediaPage>(`/chats/${chatId}/media${qs ? `?${qs}` : ''}`);
}

export function sendMessage(
  chatId: string,
  clientMessageId: string,
  ciphertext: string,
  blobIds: string[] = [],
  replyToMessageId?: string,
): Promise<SendResult> {
  return rest.post<SendResult>(`/chats/${chatId}/messages`, {
    clientMessageId,
    ciphertext,
    ...(blobIds.length ? { blobIds } : {}),
    ...(replyToMessageId ? { replyToMessageId } : {}),
  });
}

// ---- Blobs (attachments) ----

export interface BlobUploadResult {
  blobId: string;
  size: number;
}

// Upload a blob as raw bytes (octet-stream, no JSON/base64). The server computes
// sha256 on the fly, deduplicates and returns blobId. Bypasses the request()
// JSON wrapper: the body is a byte stream, not a serialized object.
export async function uploadBlob(bytes: Blob): Promise<BlobUploadResult> {
  const headers: Record<string, string> = {
    'content-type': 'application/octet-stream',
  };
  const token = getToken();
  if (token) headers['authorization'] = `Bearer ${token}`;
  const res = await fetch(apiUrl('/blobs'), {
    method: 'POST',
    headers,
    body: bytes,
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new ApiError(res.status, data);
  return data as BlobUploadResult;
}

// Download a blob as a stream. An Authorization header cannot be attached to
// <img src>, so we fetch it and return a Blob (the caller creates an object URL).
export async function fetchBlob(blobId: string): Promise<Blob> {
  const headers: Record<string, string> = {};
  const token = getToken();
  if (token) headers['authorization'] = `Bearer ${token}`;
  const res = await fetch(apiUrl(`/blobs/${blobId}`), { headers });
  if (!res.ok) throw new ApiError(res.status, null);
  return res.blob();
}

// ---- Link previews (#32) ----

export interface UnfurlPreview {
  url: string;
  title: string;
  description?: string;
  siteName?: string;
  image?: { mime: string; dataBase64: string };
}

// Unfurl a link: the server fetches the page itself (CORS blocks the browser)
// and returns OpenGraph metadata + preview image bytes. preview=null means no preview.
export function unfurl(url: string): Promise<{ preview: UnfurlPreview | null }> {
  return rest.post<{ preview: UnfurlPreview | null }>('/unfurl', { url });
}

export function editMessage(
  messageId: string,
  ciphertext: string,
): Promise<{ messageId: string; editedAt: string }> {
  return rest.patch(`/messages/${messageId}`, { ciphertext });
}

export function deleteMessage(
  messageId: string,
): Promise<{ messageId: string }> {
  return rest.del(`/messages/${messageId}`);
}

// ---- Reactions (#23) ----

export interface ReactionResult {
  reactions: ReactionGroup[];
  action: 'added' | 'removed';
}

export function toggleReaction(
  messageId: string,
  emoji: string,
): Promise<ReactionResult> {
  return rest.put<ReactionResult>(`/messages/${messageId}/reactions`, { emoji });
}

// ---- Drafts (#41) ----

export function getDraft(chatId: string): Promise<{ ciphertext: string }> {
  return rest.get(`/chats/${chatId}/draft`);
}

export function saveDraft(chatId: string, ciphertext: string): Promise<{ ok: boolean }> {
  return rest.put(`/chats/${chatId}/draft`, { ciphertext });
}

export function deleteDraft(chatId: string): Promise<{ ok: boolean }> {
  return rest.del(`/chats/${chatId}/draft`);
}

// ---- Activity (#36) ----

export function reportActivity(): Promise<{ ok: boolean }> {
  return rest.post('/me/activity');
}

// ---- Push notifications (#74) ----

export function subscribePush(input: {
  deviceId: string;
  provider: string;
  endpoint: string;
}): Promise<{ subscriptionId: string }> {
  return rest.post<{ subscriptionId: string }>('/push/subscriptions', input);
}

export function unsubscribePush(subscriptionId: string): Promise<{ ok: boolean }> {
  return rest.del<{ ok: boolean }>(`/push/subscriptions/${subscriptionId}`);
}

// ---- Device management (#77) ----

export interface DeviceInfo {
  deviceId: string;
  createdAt: string;
  lastSeenAt: string | null;
}

export function getDevices(): Promise<{ devices: DeviceInfo[] }> {
  return rest.get<{ devices: DeviceInfo[] }>('/me');
}

export function deleteDevice(deviceId: string): Promise<{ ok: boolean }> {
  return rest.del<{ ok: boolean }>(`/devices/${deviceId}`);
}

export function deleteAllDevices(): Promise<{ ok: boolean }> {
  return rest.del<{ ok: boolean }>('/devices');
}

// ---- Profiles and notes (#22) ----

export function getUserProfile(userId: string): Promise<UserProfile> {
  return rest.get<UserProfile>(`/users/${userId}`);
}

export function searchUsers(query: string): Promise<{ users: UserProfile[] }> {
  return rest.get<{ users: UserProfile[] }>(`/users?search=${encodeURIComponent(query)}`);
}

export function getNote(targetId: string): Promise<{ note: UserNote | null }> {
  return rest.get<{ note: UserNote | null }>(`/me/notes/${targetId}`);
}

export function saveNote(targetId: string, text: string): Promise<{ note: UserNote | null }> {
  return rest.put<{ note: UserNote | null }>(`/me/notes/${targetId}`, { text });
}

// ---- Stickers (#63) ----

export function createStickerPack(title: string): Promise<StickerPack> {
  return rest.post<StickerPack>('/sticker-packs', { title });
}

export function getMyStickerPacks(): Promise<{ packs: StickerPack[] }> {
  return rest.get<{ packs: StickerPack[] }>('/sticker-packs');
}

export function installStickerPack(packId: string): Promise<{ ok: boolean }> {
  return rest.post<{ ok: boolean }>(`/sticker-packs/${packId}/install`);
}

export function uninstallStickerPack(packId: string): Promise<{ ok: boolean }> {
  return rest.del<{ ok: boolean }>(`/sticker-packs/${packId}/install`);
}

export function deleteStickerPack(packId: string): Promise<{ ok: boolean }> {
  return rest.del<{ ok: boolean }>(`/sticker-packs/${packId}`);
}

export function getStickerPackItems(packId: string): Promise<{ items: StickerItem[] }> {
  return rest.get<{ items: StickerItem[] }>(`/sticker-packs/${packId}/items`);
}

export function addStickerItem(
  packId: string,
  blobId: string,
  emoji?: string,
): Promise<{ itemId: string; position: number }> {
  return rest.post<{ itemId: string; position: number }>(
    `/sticker-packs/${packId}/items`,
    { blobId, emoji },
  );
}

export function deleteStickerItem(packId: string, itemId: string): Promise<{ ok: boolean }> {
  return rest.del<{ ok: boolean }>(`/sticker-packs/${packId}/items/${itemId}`);
}

export function searchStickerPacks(query: string): Promise<{ packs: StickerPack[] }> {
  return rest.get<{ packs: StickerPack[] }>(`/sticker-packs/search?q=${encodeURIComponent(query)}`);
}

// ---- GIF (#63) ----

export interface GifResult {
  id: string;
  title: string;
  url: string;
  fullUrl: string;
  width: number;
  height: number;
}

export function searchGifs(
  query: string,
  opts: { limit?: number; pos?: string } = {},
): Promise<{ gifs: GifResult[]; next: string | null }> {
  const params = new URLSearchParams({ q: query });
  if (opts.limit) params.set('limit', String(opts.limit));
  if (opts.pos) params.set('pos', opts.pos);
  return rest.get<{ gifs: GifResult[]; next: string | null }>(`/gifs/search?${params}`);
}

// ---- Channels ----

export interface ChannelSearchResult {
  chatId: string;
  title: string;
  username: string;
  description: string;
  subscriberCount: number;
}

export function searchChannels(query: string): Promise<{ chats: ChannelSearchResult[] }> {
  return rest.get<{ chats: ChannelSearchResult[] }>(
    `/chats/search?q=${encodeURIComponent(query)}`,
  );
}

export async function resolveChannelId(id: string): Promise<string> {
  if (/^\d+$/.test(id)) return id;
  const res = await searchChannels(id);
  const match = res.chats.find((c) => c.username === id);
  if (!match) throw new Error('Channel not found');
  return match.chatId;
}

export function createChannel(
  title: string,
  channelUsername: string,
  members: string[] = [],
): Promise<Chat> {
  return rest.post<Chat>('/chats', {
    type: 'group',
    title,
    channelUsername,
    members,
  });
}

export function subscribeChannel(chatId: string): Promise<{ ok: boolean; already?: boolean }> {
  return rest.post<{ ok: boolean; already?: boolean }>(`/chats/${chatId}/subscribe`);
}

export function unsubscribeChannel(chatId: string): Promise<{ ok: boolean }> {
  return rest.del<{ ok: boolean }>(`/chats/${chatId}/subscribe`);
}

export function recordViews(
  chatId: string,
  messageIds: string[],
): Promise<{ ok: boolean }> {
  return rest.post<{ ok: boolean }>(`/chats/${chatId}/view`, { messageIds });
}
