import type { Chat } from '../api/types';

// Display name of a chat: for groups its title, for direct chats the peer's
// username (the participant who isn't me).
export function chatTitle(chat: Chat, myUserId: string | null): string {
  if (chat.type === 'group') return chat.title ?? 'Группа';
  const other = chat.participants.find((p) => p.userId !== myUserId);
  return other?.username ?? 'Диалог';
}
