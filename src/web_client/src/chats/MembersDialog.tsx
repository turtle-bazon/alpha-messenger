import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { addMember, ApiError, getMembers, removeMember } from '../api/rest';
import type { Chat, ChatMember } from '../api/types';
import { colorFor, initialFor } from './avatar';
import { formatLastSeen } from '../util/time';
import { IconX } from '../util/icons';

// Dialog with the chat member list (opens by clicking the group title).
// Viewing is open to all members; remove buttons are visible only to the chat creator.
// Online status comes from the live onlineUsers set (self counted as online); createdBy
// and the initial roster come from GET /chats/:id/members.
export function MembersDialog({
  chat,
  myId,
  onlineUsers,
  awayUsers,
  typingUsers,
  onClose,
  onShowProfile,
}: {
  chat: Chat;
  myId: string | null;
  onlineUsers: Set<string>;
  awayUsers: Set<string>;
  // Members currently typing in this chat — their avatars get a ring (#27).
  typingUsers: Map<string, string>;
  onClose: () => void;
  onShowProfile: (userId: string) => void;
}): JSX.Element {
  const { t } = useTranslation();
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
      .catch(() => alive && setError(t('members.loadFailed')))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [chat.chatId]);

  // Esc closes the dialog.
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
          ? t('members.noRights')
          : t('members.removeFailed'),
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
      // Re-fetch the roster — the new member's correct userId and online status arrive.
      const res = await getMembers(chat.chatId);
      setMembers(res.members);
      setAddName('');
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        setError(t('newChat.userNotFound'));
      } else if (err instanceof ApiError && err.status === 409) {
        setError(t('members.alreadyMember'));
      } else if (err instanceof ApiError && err.status === 403) {
        setError(t('members.noRights'));
      } else {
        setError(t('members.addFailed'));
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
            <span className="members-title">{t('members.title')}</span>
            <span className="members-count" data-testid="members-count">
              {t('members.total', { count: members.length })}
              {onlineCount > 0
                ? `, ${t('conv.onlineCount', { n: onlineCount })}`
                : ''}
            </span>
          </div>
          <button
            type="button"
            className="members-close"
            data-testid="members-close"
            aria-label={t('common.close')}
            onClick={onClose}
          >
            <IconX />
          </button>
        </div>

        {loading ? (
          <p className="members-empty">{t('common.loading')}</p>
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
                    onClick={() => onShowProfile(m.userId)}
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
                        aria-label={away ? t('conv.away') : t('conv.online')}
                      />
                    )}
                  </span>
                  <span className="member-info">
                    <span
                      className="member-name"
                      onClick={() => onShowProfile(m.userId)}
                    >
                      {m.username}
                      {m.userId === myId && ` (${t('members.you')})`}
                    </span>
                    <span className="member-status">
                      {isOwner ? t('members.owner') :
                       online ? t('conv.online') :
                       away ? (m.lastActiveAt ? `${t('conv.away')}. ${formatLastSeen(m.lastActiveAt)}` : t('conv.away')) :
                       m.lastActiveAt ? formatLastSeen(m.lastActiveAt) :
                       t('conv.offline')}
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
                      {t('members.remove')}
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
              placeholder={t('members.addPlaceholder')}
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
              {t('members.add')}
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
