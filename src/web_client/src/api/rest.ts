import { apiUrl } from './config';
import { getToken } from './session';
import type { AuthResult, Chat, ChatMembers, Me, Message } from './types';

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
export function getPresence(): Promise<{ online: string[] }> {
  return rest.get<{ online: string[] }>('/presence');
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
}

export function sendMessage(
  chatId: string,
  clientMessageId: string,
  ciphertext: string,
  blobIds: string[] = [],
): Promise<SendResult> {
  return rest.post<SendResult>(`/chats/${chatId}/messages`, {
    clientMessageId,
    ciphertext,
    ...(blobIds.length ? { blobIds } : {}),
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
