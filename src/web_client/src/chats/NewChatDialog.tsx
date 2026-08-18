import { FormEvent, useEffect, useMemo, useState } from 'react';
import { ApiError } from '../api/rest';
import type { Participant } from '../api/types';
import { IconX } from '../util/icons';

export function NewChatDialog({
  knownUsers,
  onCreateDirect,
  onCreateGroup,
  onCreateChannel,
  onClose,
}: {
  knownUsers: Participant[];
  onCreateDirect: (username: string) => Promise<void>;
  onCreateGroup: (title: string, members: string[]) => Promise<void>;
  onCreateChannel: (title: string, channelUsername: string) => Promise<void>;
  onClose: () => void;
}): JSX.Element {
  const [mode, setMode] = useState<'direct' | 'group' | 'channel'>('direct');
  const [username, setUsername] = useState('');
  const [title, setTitle] = useState('');
  const [channelUsername, setChannelUsername] = useState('');
  const [search, setSearch] = useState('');
  const [members, setMembers] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Esc закрывает модалку.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Доступные кандидаты: знакомые пользователи, ещё не выбранные, отфильтрованные
  // по строке поиска (подстрока, регистр не важен).
  const candidates = useMemo(() => {
    const q = search.trim().toLowerCase();
    return knownUsers.filter(
      (u) =>
        !members.includes(u.username) &&
        (!q || u.username.toLowerCase().includes(q)),
    );
  }, [knownUsers, members, search]);

  function mapError(err: unknown): string {
    if (err instanceof ApiError) {
      if (err.status === 404) return 'Пользователь не найден';
      if (err.status === 400) {
        return mode === 'group'
          ? 'Проверьте участников'
          : 'Нельзя написать самому себе';
      }
      return 'Не удалось создать';
    }
    return 'Сервер недоступен';
  }

  function switchMode(next: 'direct' | 'group' | 'channel'): void {
    setMode(next);
    setError(null);
  }

  async function submitDirect(e: FormEvent): Promise<void> {
    e.preventDefault();
    const u = username.trim();
    if (!u || busy) return;
    setError(null);
    setBusy(true);
    try {
      await onCreateDirect(u);
      onClose();
    } catch (err) {
      setError(mapError(err));
    } finally {
      setBusy(false);
    }
  }

  function toggleMember(u: string): void {
    setMembers((m) => (m.includes(u) ? m.filter((x) => x !== u) : [...m, u]));
  }

  async function submitGroup(e: FormEvent): Promise<void> {
    e.preventDefault();
    if (busy) return;
    const t = title.trim();
    if (!t) {
      setError('Введите название группы');
      return;
    }
    if (members.length === 0) {
      setError('Добавьте хотя бы одного участника');
      return;
    }
    setError(null);
    setBusy(true);
    try {
      await onCreateGroup(t, members);
      onClose();
    } catch (err) {
      setError(mapError(err));
    } finally {
      setBusy(false);
    }
  }

  async function submitChannel(e: FormEvent): Promise<void> {
    e.preventDefault();
    if (busy) return;
    const t = title.trim();
    const u = channelUsername.trim().replace(/^@/, '');
    if (!t) {
      setError('Введите название канала');
      return;
    }
    if (!u) {
      setError('Введите @username канала');
      return;
    }
    if (!/^[a-zA-Z0-9_]{5,32}$/.test(u)) {
      setError('Username: 5–32 символа, только латиница, цифры и _');
      return;
    }
    setError(null);
    setBusy(true);
    try {
      await onCreateChannel(t, u);
      onClose();
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setError('Этот @username уже занят');
      } else {
        setError(mapError(err));
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="new-chat-backdrop"
      data-testid="new-chat-dialog"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="new-chat-dialog">
        <div className="new-chat-tabs">
          <button
            type="button"
            data-testid="new-chat-tab-direct"
            className={mode === 'direct' ? 'is-active' : ''}
            onClick={() => switchMode('direct')}
          >
            Чат
          </button>
          <button
            type="button"
            data-testid="new-chat-tab-group"
            className={mode === 'group' ? 'is-active' : ''}
            onClick={() => switchMode('group')}
          >
            Группа
          </button>
          <button
            type="button"
            data-testid="new-chat-tab-channel"
            className={mode === 'channel' ? 'is-active' : ''}
            onClick={() => switchMode('channel')}
          >
            Канал
          </button>
          <button
            type="button"
            className="new-chat-close"
            data-testid="new-chat-close"
            aria-label="Закрыть"
            onClick={onClose}
          >
            <IconX />
          </button>
        </div>

        {mode === 'direct' && (
          <form className="new-chat-form" onSubmit={submitDirect}>
            <input
              data-testid="new-chat-input"
              aria-label="Имя пользователя"
              placeholder="Имя пользователя…"
              autoFocus
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
            <button type="submit" data-testid="new-chat-submit" disabled={busy}>
              Создать чат
            </button>
          </form>
        )}
        {mode === 'group' && (
          <form className="new-chat-form" onSubmit={submitGroup}>
            <input
              data-testid="new-group-title"
              aria-label="Название группы"
              placeholder="Название группы…"
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
            {members.length > 0 && (
              <div className="new-group-members">
                {members.map((u) => (
                  <span key={u} className="group-member" data-testid="group-member">
                    {u}
                    <button
                      type="button"
                      aria-label={`Убрать ${u}`}
                      onClick={() => toggleMember(u)}
                    >
                      <IconX />
                    </button>
                  </span>
                ))}
              </div>
            )}
            {knownUsers.length === 0 ? (
              <p className="new-group-hint" data-testid="new-group-hint">
                Сначала создайте личные чаты — участников группы выбирают из тех,
                с кем уже есть переписка.
              </p>
            ) : (
              <>
                <input
                  data-testid="new-group-search"
                  aria-label="Поиск участников"
                  placeholder="Поиск участников…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
                <div className="new-group-options" data-testid="new-group-options">
                  {candidates.length === 0 ? (
                    <p className="new-group-hint">Никого не найдено</p>
                  ) : (
                    candidates.map((u) => (
                      <button
                        key={u.userId}
                        type="button"
                        className="new-group-option"
                        data-testid="new-group-option"
                        onClick={() => toggleMember(u.username)}
                      >
                        {u.username}
                      </button>
                    ))
                  )}
                </div>
              </>
            )}
            <button type="submit" data-testid="new-group-submit" disabled={busy}>
              Создать группу
            </button>
          </form>
        )}
        {mode === 'channel' && (
          <form className="new-chat-form" onSubmit={submitChannel}>
            <input
              data-testid="new-channel-title"
              aria-label="Название канала"
              placeholder="Название канала…"
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
            <div className="new-channel-username-row">
              <span className="new-channel-at">@</span>
              <input
                data-testid="new-channel-username"
                aria-label="Username канала"
                placeholder="username"
                value={channelUsername}
                onChange={(e) => setChannelUsername(e.target.value.replace(/[^a-zA-Z0-9_]/g, ''))}
              />
            </div>
            <p className="new-group-hint">
              Канал — это публичная страница. Подписчики видят только ваши посты.
            </p>
            <button type="submit" data-testid="new-channel-submit" disabled={busy}>
              Создать канал
            </button>
          </form>
        )}

        {error && (
          <p className="new-chat-error" data-testid="new-chat-error">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
