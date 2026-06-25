import { FormEvent, useState } from 'react';
import { ApiError, register } from '../api/rest';
import { getDeviceId, setSession } from '../api/session';
import { PasswordInput } from './PasswordInput';

// Регистрация по инвайт-ссылке (/register?invite=CODE). Без валидного кода
// саморегистрации нет (см. architecture.md) — поле invite приходит из URL.
export function RegisterScreen({
  invite,
  onAuthed,
  onGoLogin,
}: {
  invite: string;
  onAuthed: () => void;
  onGoLogin: () => void;
}): JSX.Element {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent): Promise<void> {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await register({
        username,
        password,
        invite,
        deviceId: getDeviceId(),
      });
      setSession(res.accessToken, res.userId);
      history.replaceState(null, '', '/');
      onAuthed();
    } catch (err) {
      if (err instanceof ApiError) {
        setError(
          err.status === 409
            ? 'Это имя уже занято'
            : 'Инвайт недействителен или истёк',
        );
      } else {
        setError('Сервер недоступен');
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-screen" data-testid="register-screen">
      <form className="auth-card" onSubmit={submit}>
        <h1>Регистрация</h1>
        {!invite && (
          <p className="auth-error">Нужна инвайт-ссылка для регистрации</p>
        )}
        <input
          aria-label="Имя пользователя"
          placeholder="Имя пользователя"
          autoComplete="username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
        />
        <PasswordInput
          autoComplete="new-password"
          value={password}
          onChange={setPassword}
        />
        {error && <p className="auth-error">{error}</p>}
        <button type="submit" disabled={busy || !invite || !username || !password}>
          {busy ? '...' : 'Создать аккаунт'}
        </button>
        <button type="button" className="auth-link" onClick={onGoLogin}>
          Уже есть аккаунт? Войти
        </button>
      </form>
    </div>
  );
}
