import { FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ApiError, register } from '../api/rest';
import { getDeviceId, setSession } from '../api/session';
import { PasswordInput } from './PasswordInput';

// Registration via invite link (/register?invite=CODE). Without a valid code
// there is no self-registration (see architecture.md) — invite comes from the URL.
export function RegisterScreen({
  invite,
  onAuthed,
  onGoLogin,
}: {
  invite: string;
  onAuthed: () => void;
  onGoLogin: () => void;
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
            ? t('auth.nameTaken')
            : t('auth.inviteInvalid'),
        );
      } else {
        setError(t('auth.serverUnavailable'));
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-screen" data-testid="register-screen">
      <form className="auth-card" onSubmit={submit}>
        <h1>{t('auth.registerTitle')}</h1>
        {!invite && (
          <p className="auth-error">{t('auth.inviteNeeded')}</p>
        )}
        <input
          aria-label={t('auth.username')}
          placeholder={t('auth.username')}
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
          {busy ? '...' : t('auth.registerSubmit')}
        </button>
        <button type="button" className="auth-link" onClick={onGoLogin}>
          {t('auth.haveAccount')}
        </button>
      </form>
    </div>
  );
}
