import { apiUrl } from './config';
import { getToken } from './session';
import type {
  AuthResult, Chat, ChatMembers, Me, Message, ReactionGroup,
  UserProfile, UserNote, StickerPack, StickerItem,
} from './types';

// Ошибка с HTTP-статусом и распарсенным телом — экраны различают 400/404/409 и т.п.
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
  auth?: boolean; // подставить Authorization: Bearer <token>
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

// ---- Аутентификация ----

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

// ---- Чаты ----

export async function getChats(): Promise<Chat[]> {
  const res = await rest.get<{ chats: Chat[] }>('/chats');
  return res.chats;
}

// Создание direct-чата по username собеседника. Сервер дедуплицирует: вернёт
// существующий чат (200) либо создаст новый (201) — клиенту приходит объект чата.
export function createDirect(username: string): Promise<Chat> {
  return rest.post<Chat>('/chats', { type: 'direct', username });
}

// Создание группы: название + список участников по username (себя добавлять не
// нужно — сервер включит создателя сам). Возвращает объект чата.
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

// Список участников чата с признаком онлайн и указанием создателя.
export function getMembers(chatId: string): Promise<ChatMembers> {
  return rest.get<ChatMembers>(`/chats/${chatId}/members`);
}

// Добавление участника в группу по username (право — у создателя чата).
export function addMember(
  chatId: string,
  username: string,
): Promise<{ chatId: string; userId: string }> {
  return rest.post(`/chats/${chatId}/members`, { username });
}

// Удаление участника из группы (право — у создателя чата).
export function removeMember(
  chatId: string,
  userId: string,
): Promise<{ chatId: string; userId: string }> {
  return rest.del(`/chats/${chatId}/members/${userId}`);
}

// Снимок онлайна со-участников для сидирования presence после коннекта.
export interface PresenceInfo {
  online: boolean;
  away: boolean;
  lastActiveAt?: string;
}

export function getPresence(): Promise<{ presence: Record<string, PresenceInfo> }> {
  return rest.get<{ presence: Record<string, PresenceInfo> }>('/presence');
}

// ---- Сообщения ----

export interface MessagesPage {
  messages: Message[]; // от новых к старым (DESC)
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

// ---- Блобы (вложения) ----

export interface BlobUploadResult {
  blobId: string;
  size: number;
}

// Загрузка блоба сырыми байтами (octet-stream, без JSON/base64). Сервер считает
// sha256 на лету, дедуплицирует и возвращает blobId. Идёт мимо JSON-обёртки
// request(): тело — поток байтов, а не сериализованный объект.
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

// Скачивание блоба потоком. Заголовок Authorization нельзя навесить на <img src>,
// поэтому тянем через fetch и отдаём Blob (вызывающий делает object URL).
export async function fetchBlob(blobId: string): Promise<Blob> {
  const headers: Record<string, string> = {};
  const token = getToken();
  if (token) headers['authorization'] = `Bearer ${token}`;
  const res = await fetch(apiUrl(`/blobs/${blobId}`), { headers });
  if (!res.ok) throw new ApiError(res.status, null);
  return res.blob();
}

// ---- Превью ссылок (#32) ----

export interface UnfurlPreview {
  url: string;
  title: string;
  description?: string;
  siteName?: string;
  image?: { mime: string; dataBase64: string };
}

// Развернуть ссылку: сервер сам тянет страницу (браузеру мешает CORS) и отдаёт
// метаданные OpenGraph + байты картинки превью. preview=null — превью нет.
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

// ---- Реакции (#23) ----

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

// ---- Черновики (#41) ----

export function getDraft(chatId: string): Promise<{ ciphertext: string }> {
  return rest.get(`/chats/${chatId}/draft`);
}

export function saveDraft(chatId: string, ciphertext: string): Promise<{ ok: boolean }> {
  return rest.put(`/chats/${chatId}/draft`, { ciphertext });
}

export function deleteDraft(chatId: string): Promise<{ ok: boolean }> {
  return rest.del(`/chats/${chatId}/draft`);
}

// ---- Активность (#36) ----

export function reportActivity(): Promise<{ ok: boolean }> {
  return rest.post('/me/activity');
}

// ---- Push-уведомления (#74) ----

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

// ---- Управление устройствами (#77) ----

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

// ---- Профили и заметки (#22) ----

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

// ---- Стикеры (#63) ----

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
