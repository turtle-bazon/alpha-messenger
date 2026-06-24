import { FormEvent, useState } from 'react';
import { ApiError, login } from '../api/rest';
import { getDeviceId, setSession } from '../api/session';

export function LoginScreen({
  onAuthed,
}: {
  onAuthed: () => void;
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
      const res = await login({
        username,
        password,
        deviceId: getDeviceId(),
      });
      setSession(res.accessToken, res.userId);
      onAuthed();
    } catch (err) {
      if (err instanceof ApiError) {
        setError('Неверное имя пользователя или пароль');
      } else {
        setError('Сервер недоступен');
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-screen" data-testid="login-screen">
      <form className="auth-card" onSubmit={submit}>
        <h1>Вход</h1>
        <input
          aria-label="Имя пользователя"
          placeholder="Имя пользователя"
          autoComplete="username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
        />
        <input
          aria-label="Пароль"
          placeholder="Пароль"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        {error && <p className="auth-error">{error}</p>}
        <button type="submit" disabled={busy || !username || !password}>
          {busy ? '...' : 'Войти'}
        </button>
      </form>
    </div>
  );
}
