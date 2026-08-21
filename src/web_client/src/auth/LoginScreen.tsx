import { FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ApiError, login } from '../api/rest';
import { apiUrl } from '../api/config';
import { getDeviceId, setSession } from '../api/session';
import { PasswordInput } from './PasswordInput';

export function LoginScreen({
  onAuthed,
}: {
  onAuthed: () => void;
}): JSX.Element {
  const { t } = useTranslation();
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
        <h1>{t('auth.loginTitle')}</h1>
        <input
          aria-label={t('auth.username')}
          placeholder={t('auth.username')}
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
          {busy ? '...' : t('auth.loginSubmit')}
        </button>
      </form>
    </div>
  );
}
