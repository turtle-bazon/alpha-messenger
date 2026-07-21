import { FormEvent, useEffect, useMemo, useState } from 'react';
import { ApiError } from '../api/rest';
import type { Participant } from '../api/types';
import { IconX } from '../util/icons';

// Модалка «новый чат» — точка входа из синей «+» (как кнопка compose в Telegram).
// Две вкладки: личный чат по username и группа (название + участники).
// Участников группы выбирают из уже знакомых пользователей (собеседники личных
// чатов) — свободный ввод username убран (известная проблема №4): нельзя добавить
// того, с кем ещё нет переписки. Создание выполняют переданные колбэки HomeScreen.
export function NewChatDialog({
  knownUsers,
  onCreateDirect,
  onCreateGroup,
  onClose,
}: {
  knownUsers: Participant[];
  onCreateDirect: (username: string) => Promise<void>;
  onCreateGroup: (title: string, members: string[]) => Promise<void>;
  onClose: () => void;
}): JSX.Element {
  const [mode, setMode] = useState<'direct' | 'group'>('direct');
  const [username, setUsername] = useState('');
  const [title, setTitle] = useState('');
  const [search, setSearch] = useState('');
  // Выбранные участники — по username (их ждёт onCreateGroup; сервер добавит
  // создателя сам).
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

  function switchMode(next: 'direct' | 'group'): void {
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
            Новый чат
          </button>
          <button
            type="button"
            data-testid="new-chat-tab-group"
            className={mode === 'group' ? 'is-active' : ''}
            onClick={() => switchMode('group')}
          >
            Новая группа
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

        {mode === 'direct' ? (
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
        ) : (
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

        {error && (
          <p className="new-chat-error" data-testid="new-chat-error">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
