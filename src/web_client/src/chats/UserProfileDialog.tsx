import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { getNote, getUserProfile, saveNote } from '../api/rest';
import type { UserNote, UserProfile } from '../api/types';
import { colorFor, initialFor } from './avatar';
import { formatLastSeen } from '../util/time';
import { intlLocale } from '../i18n';
import { IconX } from '../util/icons';

// User profile dialog (#22). Opens by clicking the avatar/name
// in the chat header, the members list, or a message author's name.
export function UserProfileDialog({
  userId,
  myId,
  onlineUsers,
  awayUsers,
  onClose,
}: {
  userId: string;
  myId: string | null;
  onlineUsers: Set<string>;
  awayUsers: Set<string>;
  onClose: () => void;
}): JSX.Element {
  const { t } = useTranslation();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [note, setNote] = useState<UserNote | null>(null);
  const [noteText, setNoteText] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dirty = useRef(false);

  // Load the profile and note.
  useEffect(() => {
    let alive = true;
    Promise.all([getUserProfile(userId), getNote(userId)])
      .then(([p, n]) => {
        if (!alive) return;
        setProfile(p);
        setNote(n.note);
        setNoteText(n.note?.text ?? '');
      })
      .catch(() => alive && setError(t('profile.loadFailed')))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [userId]);

  // Esc closes the dialog.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Auto-save the note with a 1s debounce.
  const scheduleSave = useCallback(
    (text: string) => {
      dirty.current = true;
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => {
        saveNote(userId, text)
          .then((res) => {
            setNote(res.note);
          })
          .catch(() => {});
      }, 1000);
    },
    [userId],
  );

  // Clear the timer on unmount.
  useEffect(() => {
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, []);

  const isMe = userId === myId;
  const online = isMe || onlineUsers.has(userId);
  const away = awayUsers.has(userId);

  const createdDate = profile
    ? new Date(profile.createdAt).toLocaleDateString('ru-RU', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      })
    : '';

  return (
    <div
      className="members-backdrop"
      data-testid="user-profile-dialog"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="profile-dialog">
        <div className="profile-head">
          <span className="profile-title">{t('profile.title')}</span>
          <button
            type="button"
            className="members-close"
            data-testid="profile-close"
            aria-label={t('common.close')}
            onClick={onClose}
          >
            <IconX />
          </button>
        </div>

        {loading ? (
          <p className="members-empty">{t('common.loading')}</p>
        ) : error ? (
          <p className="members-error" data-testid="profile-error">{error}</p>
        ) : profile ? (
          <div className="profile-body">
            <div
              className="profile-avatar"
              style={{ backgroundColor: colorFor(profile.username) }}
            >
              {initialFor(profile.username)}
              {(online || away) && (
                <span
                  className={'member-online-dot' + (away ? ' is-away' : '')}
                  aria-label={away ? t('conv.away') : t('conv.online')}
                />
              )}
            </div>

            <div className="profile-username">{profile.username}</div>

            <div className="profile-meta">
              <div className="profile-meta-row">
                <span className="profile-meta-label">{t('profile.registered')}</span>
                <span className="profile-meta-value">{createdDate}</span>
              </div>
              <div className="profile-meta-row">
                <span className="profile-meta-label">{t('profile.lastSeenLabel')}</span>
                <span className="profile-meta-value">
                  {isMe
                    ? t('profile.now')
                    : profile.lastActiveAt
                      ? formatLastSeen(profile.lastActiveAt)
                      : t('profile.noData')}
                </span>
              </div>
            </div>

            {!isMe && (
              <div className="profile-note-section">
                <div className="profile-note-label">{t('profile.note')}</div>
                <textarea
                  className="profile-note-input"
                  data-testid="profile-note-input"
                  placeholder={t('profile.notePlaceholder')}
                  rows={3}
                  value={noteText}
                  onChange={(e) => {
                    setNoteText(e.target.value);
                    scheduleSave(e.target.value);
                  }}
                />
                {note && (
                  <div className="profile-note-hint">
                    {t('profile.savedAt', {
                      date: new Date(note.updatedAt).toLocaleString(intlLocale()),
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}
