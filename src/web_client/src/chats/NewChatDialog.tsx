import { FormEvent, useEffect, useState } from 'react';
import { ApiError } from '../api/rest';

// Модалка «новый чат» — точка входа из синей «+» (как кнопка compose в Telegram).
// Две вкладки: личный чат по username и группа (название + участники).
// Создание выполняют переданные колбэки HomeScreen; успех — закрывает модалку.
export function NewChatDialog({
  onCreateDirect,
  onCreateGroup,
  onClose,
}: {
  onCreateDirect: (username: string) => Promise<void>;
  onCreateGroup: (title: string, members: string[]) => Promise<void>;
  onClose: () => void;
}): JSX.Element {
  const [mode, setMode] = useState<'direct' | 'group'>('direct');
  const [username, setUsername] = useState('');
  const [title, setTitle] = useState('');
  const [member, setMember] = useState('');
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

  function addMember(): void {
    const u = member.trim();
    if (!u) return;
    setMembers((m) => (m.includes(u) ? m : [...m, u]));
    setMember('');
  }

  function removeMember(u: string): void {
    setMembers((m) => m.filter((x) => x !== u));
  }

  async function submitGroup(e: FormEvent): Promise<void> {
    e.preventDefault();
    if (busy) return;
    const t = title.trim();
    // Учитываем участника, набранного, но не добавленного кнопкой.
    const pending = member.trim();
    const all =
      pending && !members.includes(pending) ? [...members, pending] : members;
    if (!t) {
      setError('Введите название группы');
      return;
    }
    if (all.length === 0) {
      setError('Добавьте хотя бы одного участника');
      return;
    }
    setError(null);
    setBusy(true);
    try {
      await onCreateGroup(t, all);
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
            ✕
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
            <div className="new-group-add">
              <input
                data-testid="new-group-member"
                aria-label="Добавить участника"
                placeholder="Имя участника…"
                value={member}
                onChange={(e) => setMember(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    addMember();
                  }
                }}
              />
              <button
                type="button"
                data-testid="new-group-add"
                onClick={addMember}
              >
                +
              </button>
            </div>
            {members.length > 0 && (
              <div className="new-group-members">
                {members.map((u) => (
                  <span key={u} className="group-member" data-testid="group-member">
                    {u}
                    <button
                      type="button"
                      aria-label={`Убрать ${u}`}
                      onClick={() => removeMember(u)}
                    >
                      ✕
                    </button>
                  </span>
                ))}
              </div>
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
