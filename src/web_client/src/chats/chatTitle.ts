import type { Chat } from '../api/types';

// Отображаемое имя чата: для группы — её title, для direct — username собеседника
// (того участника, который не я).
export function chatTitle(chat: Chat, myUserId: string | null): string {
  if (chat.type === 'group') return chat.title ?? 'Группа';
  const other = chat.participants.find((p) => p.userId !== myUserId);
  return other?.username ?? 'Диалог';
}
