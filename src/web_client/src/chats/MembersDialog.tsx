import { useEffect, useState } from 'react';
import { addMember, ApiError, getMembers, removeMember } from '../api/rest';
import type { Chat, ChatMember } from '../api/types';
import { colorFor, initialFor } from './avatar';
import { formatLastSeen } from '../util/time';
import { IconX } from '../util/icons';

// Окно со списком участников чата (открывается кликом по заголовку группы).
// Просмотр — всем участникам; кнопки «удалить» видит только создатель чата.
// Онлайн берём из живого множества onlineUsers (себя считаем онлайн), createdBy
// и стартовый состав — из GET /chats/:id/members.
export function MembersDialog({
  chat,
  myId,
  onlineUsers,
  awayUsers,
  typingUsers,
  onClose,
}: {
  chat: Chat;
  myId: string | null;
  onlineUsers: Set<string>;
  awayUsers: Set<string>;
  // Печатающие сейчас в этом чате участники — их аватар обводим окантовкой (#27).
  typingUsers: Map<string, string>;
  onClose: () => void;
}): JSX.Element {
  const [members, setMembers] = useState<ChatMember[]>([]);
  const [createdBy, setCreatedBy] = useState<string | null>(chat.createdBy);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [removing, setRemoving] = useState<Set<string>>(new Set());
  const [addName, setAddName] = useState('');
  const [adding, setAdding] = useState(false);

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

  async function onAdd(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    const username = addName.trim();
    if (!username || adding) return;
    setError(null);
    setAdding(true);
    try {
      await addMember(chat.chatId, username);
      // Перечитываем состав — придёт корректный userId и онлайн нового участника.
      const res = await getMembers(chat.chatId);
      setMembers(res.members);
      setAddName('');
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        setError('Пользователь не найден');
      } else if (err instanceof ApiError && err.status === 409) {
        setError('Уже участник');
      } else if (err instanceof ApiError && err.status === 403) {
        setError('Недостаточно прав');
      } else {
        setError('Не удалось добавить');
      }
    } finally {
      setAdding(false);
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
            <IconX />
          </button>
        </div>

        {loading ? (
          <p className="members-empty">Загрузка…</p>
        ) : (
          <ul className="members-list" data-testid="members-list">
            {members.map((m) => {
              const online = isOnline(m.userId);
              const away = awayUsers.has(m.userId);
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
                    {typingUsers.has(m.userId) && (
                      <span
                        className="avatar-typing-ring"
                        data-testid="member-typing"
                        aria-hidden="true"
                      />
                    )}
                    {(online || away) && (
                      <span
                        className={'member-online-dot' + (away ? ' is-away' : '')}
                        data-testid="member-online"
                        aria-label={away ? 'отошёл' : 'в сети'}
                      />
                    )}
                  </span>
                  <span className="member-info">
                    <span className="member-name">
                      {m.username}
                      {m.userId === myId && ' (вы)'}
                    </span>
                    <span className="member-status">
                      {isOwner ? 'создатель' :
                       online ? 'в сети' :
                       away ? (m.lastActiveAt ? `отошёл. ${formatLastSeen(m.lastActiveAt)}` : 'отошёл') :
                       m.lastActiveAt ? formatLastSeen(m.lastActiveAt) :
                       'не в сети'}
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

        {chat.type === 'group' && amOwner && (
          <form className="members-add" onSubmit={onAdd}>
            <input
              className="members-add-input"
              data-testid="member-add-input"
              placeholder="Добавить по username"
              value={addName}
              onChange={(e) => setAddName(e.target.value)}
              disabled={adding}
            />
            <button
              type="submit"
              className="members-add-btn"
              data-testid="member-add-submit"
              disabled={adding || addName.trim() === ''}
            >
              Добавить
            </button>
          </form>
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
