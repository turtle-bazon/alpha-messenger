import { useEffect, useRef, useState } from 'react';
import { updateChat, ApiError } from '../api/rest';
import type { Chat } from '../api/types';
import { IconX } from '../util/icons';

// Group info: title, description, "Members" button.
// Owner can edit; members can only view.
export function GroupInfoDialog({
  chat,
  myId,
  onOpenMembers,
  onClose,
  onUpdated,
}: {
  chat: Chat;
  myId: string | null;
  onOpenMembers: () => void;
  onClose: () => void;
  onUpdated: (chat: Chat) => void;
}): JSX.Element {
  const isOwner = chat.createdBy === myId;
  const [title, setTitle] = useState(chat.title ?? '');
  const [description, setDescription] = useState(chat.description ?? '');
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, []);

  function scheduleSave(nextTitle: string, nextDesc: string): void {
    setDirty(true);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      setSaving(true);
      setError(null);
      try {
        const updated = await updateChat(chat.chatId, {
          title: nextTitle,
          description: nextDesc,
        });
        onUpdated(updated);
        setDirty(false);
      } catch (err) {
        setError(
          err instanceof ApiError && err.status === 403
            ? 'Недостаточно прав'
            : 'Не удалось сохранить',
        );
      } finally {
        setSaving(false);
      }
    }, 1000);
  }

  return (
    <div
      className="members-backdrop"
      data-testid="group-info-dialog"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="profile-dialog">
        <div className="profile-head">
          <span className="profile-title">Информация о группе</span>
          <button
            type="button"
            className="members-close"
            data-testid="group-info-close"
            aria-label="Закрыть"
            onClick={onClose}
          >
            <IconX />
          </button>
        </div>

        <div className="profile-body">
          {isOwner ? (
            <input
              className="group-info-title-input"
              data-testid="group-info-title"
              value={title}
              onChange={(e) => {
                setTitle(e.target.value);
                scheduleSave(e.target.value, description);
              }}
              placeholder="Название группы"
            />
          ) : (
            <div className="profile-username">
              {chat.title || 'Без названия'}
            </div>
          )}

          {isOwner ? (
            <textarea
              className="profile-note-input"
              data-testid="group-info-description"
              placeholder="Описание группы…"
              rows={3}
              value={description}
              onChange={(e) => {
                setDescription(e.target.value);
                scheduleSave(title, e.target.value);
              }}
            />
          ) : (
            <div className="group-info-description-view">
              {chat.description || 'Нет описания'}
            </div>
          )}

          {isOwner && saving && (
            <div className="profile-note-hint">Сохранение…</div>
          )}
          {isOwner && dirty && !saving && (
            <div className="profile-note-hint">Есть несохранённые изменения</div>
          )}
          {error && (
            <div className="members-error" data-testid="group-info-error">
              {error}
            </div>
          )}

          <button
            type="button"
            className="group-info-members-btn"
            data-testid="group-info-members"
            onClick={onOpenMembers}
          >
            Участники
          </button>
        </div>
      </div>
    </div>
  );
}
