import { FormEvent, useState } from 'react';
import { ApiError, login } from '../api/rest';
import { apiUrl } from '../api/config';
import { getDeviceId, setSession } from '../api/session';
import { PasswordInput } from './PasswordInput';

export function LoginScreen({
  onAuthed,
}: {
  onAuthed: () => void;
}): JSX.Element {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // DEBUG: показываем что происходит
  const debugUrl = apiUrl('/auth/login');
  const debugLs = localStorage.getItem('alpha.serverUrl') ?? '(пусто)';
  const debugOrigin = window.location.origin;
  const debugProto = window.location.protocol;

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
      const url = apiUrl('/auth/login');
      if (err instanceof ApiError) {
        setError(`HTTP ${err.status} — ${url}`);
      } else {
        const msg = err instanceof Error ? err.message : String(err);
        setError(`${msg} — ${url}`);
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
        <PasswordInput
          autoComplete="current-password"
          value={password}
          onChange={setPassword}
        />
        {error && <p className="auth-error">{error}</p>}
        <button type="submit" disabled={busy || !username || !password}>
          {busy ? '...' : 'Войти'}
        </button>
      </form>
      <div style={{
        marginTop: 12, padding: 8, fontSize: 11, color: '#888',
        background: '#1a1a1a', borderRadius: 6, fontFamily: 'monospace',
        wordBreak: 'break-all',
      }}>
        <div>protocol: <b>{debugProto}</b></div>
        <div>origin: <b>{debugOrigin}</b></div>
        <div>localStorage: <b>{debugLs}</b></div>
        <div>API URL: <b>{debugUrl}</b></div>
      </div>
    </div>
  );
}
