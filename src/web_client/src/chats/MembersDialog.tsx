import { useEffect, useState } from 'react';
import { ApiError, getMembers, removeMember } from '../api/rest';
import type { Chat, ChatMember } from '../api/types';
import { colorFor, initialFor } from './avatar';

// Окно со списком участников чата (открывается кликом по заголовку группы).
// Просмотр — всем участникам; кнопки «удалить» видит только создатель чата.
// Онлайн берём из живого множества onlineUsers (себя считаем онлайн), createdBy
// и стартовый состав — из GET /chats/:id/members.
export function MembersDialog({
  chat,
  myId,
  onlineUsers,
  onClose,
}: {
  chat: Chat;
  myId: string | null;
  onlineUsers: Set<string>;
  onClose: () => void;
}): JSX.Element {
  const [members, setMembers] = useState<ChatMember[]>([]);
  const [createdBy, setCreatedBy] = useState<string | null>(chat.createdBy);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [removing, setRemoving] = useState<Set<string>>(new Set());

  useEffect(() => {
    let alive = true;
    getMembers(chat.chatId)
      .then((res) => {
        if (!alive) return;
        setMembers(res.members);
        setCreatedBy(res.createdBy);
      })
      .catch(() => alive && setError('Не удалось загрузить участников'))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [chat.chatId]);

  // Esc закрывает окно.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const amOwner = createdBy != null && createdBy === myId;

  function isOnline(userId: string): boolean {
    return userId === myId || onlineUsers.has(userId);
  }

  async function onRemove(userId: string): Promise<void> {
    setError(null);
    setRemoving((s) => new Set(s).add(userId));
    try {
      await removeMember(chat.chatId, userId);
      setMembers((m) => m.filter((x) => x.userId !== userId));
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 403
          ? 'Недостаточно прав'
          : 'Не удалось удалить',
      );
    } finally {
      setRemoving((s) => {
        const next = new Set(s);
        next.delete(userId);
        return next;
      });
    }
  }

  const onlineCount = members.filter((m) => isOnline(m.userId)).length;

  return (
    <div
      className="members-backdrop"
      data-testid="members-dialog"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="members-dialog">
        <div className="members-head">
          <div className="members-head-text">
            <span className="members-title">Участники</span>
            <span className="members-count" data-testid="members-count">
              {members.length} всего
              {onlineCount > 0 ? `, ${onlineCount} в сети` : ''}
            </span>
          </div>
          <button
            type="button"
            className="members-close"
            data-testid="members-close"
            aria-label="Закрыть"
            onClick={onClose}
          >
            ✕
          </button>
        </div>

        {loading ? (
          <p className="members-empty">Загрузка…</p>
        ) : (
          <ul className="members-list" data-testid="members-list">
            {members.map((m) => {
              const online = isOnline(m.userId);
              const isOwner = m.userId === createdBy;
              const canRemove = amOwner && !isOwner;
              return (
                <li
                  key={m.userId}
                  className="member-row"
                  data-testid="member-row"
                >
                  <span
                    className="member-avatar"
                    style={{ backgroundColor: colorFor(m.username) }}
                  >
                    {initialFor(m.username)}
                    {online && (
                      <span
                        className="member-online-dot"
                        data-testid="member-online"
                        aria-label="в сети"
                      />
                    )}
                  </span>
                  <span className="member-info">
                    <span className="member-name">
                      {m.username}
                      {m.userId === myId && ' (вы)'}
                    </span>
                    <span className="member-status">
                      {isOwner ? 'создатель' : online ? 'в сети' : 'не в сети'}
                    </span>
                  </span>
                  {canRemove && (
                    <button
                      type="button"
                      className="member-remove"
                      data-testid="member-remove"
                      disabled={removing.has(m.userId)}
                      onClick={() => onRemove(m.userId)}
                    >
                      удалить
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        {error && (
          <p className="members-error" data-testid="members-error">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
