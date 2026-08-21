import { useState } from 'react';
import { useTranslation } from 'react-i18next';

interface SetupScreenProps {
  onConfigured: (url: string) => void;
}

export function SetupScreen({ onConfigured }: SetupScreenProps): JSX.Element {
  const { t } = useTranslation();
  const [url, setUrl] = useState('');
  const [error, setError] = useState('');
  const [connecting, setConnecting] = useState(false);

  function handleSubmit(e: React.FormEvent): void {
    e.preventDefault();
    const trimmed = url.trim();

    try {
      new URL(trimmed);
    } catch {
      setError(t('setup.badUrl'));
      return;
    }

    setError('');
    setConnecting(true);

    fetch(trimmed, { method: 'HEAD', mode: 'no-cors' })
      .then(() => onConfigured(trimmed))
      .catch(() => onConfigured(trimmed));
  }

  return (
    <div className="setup-screen">
      <div className="setup-card">
        <h1 className="setup-title">Alpha Messenger</h1>
        <p className="setup-subtitle">{t('setup.subtitle')}</p>
        <form onSubmit={handleSubmit}>
          <label htmlFor="server-url" className="setup-label">
            {t('setup.serverUrl')}
          </label>
          <input
            id="server-url"
            type="url"
            className="setup-input"
            placeholder="https://example.com"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            autoFocus
            required
          />
          {error && <p className="setup-error">{error}</p>}
          <button
            type="submit"
            className="setup-btn"
            disabled={connecting}
          >
            {connecting ? t('setup.connecting') : t('setup.connect')}
          </button>
        </form>
      </div>
    </div>
  );
}
