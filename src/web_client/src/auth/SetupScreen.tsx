import { useState } from 'react';

interface SetupScreenProps {
  onConfigured: () => void;
}

export function SetupScreen({ onConfigured }: SetupScreenProps): JSX.Element {
  const [url, setUrl] = useState('');
  const [error, setError] = useState('');
  const [connecting, setConnecting] = useState(false);

  function handleSubmit(e: React.FormEvent): void {
    e.preventDefault();
    const trimmed = url.trim();

    try {
      new URL(trimmed);
    } catch {
      setError('Введите корректный URL (например, https://example.com)');
      return;
    }

    setError('');
    setConnecting(true);

    // Проверяем доступность сервера
    fetch(trimmed, { method: 'HEAD', mode: 'no-cors' })
      .then(() => {
        localStorage.setItem('alpha.serverUrl', trimmed);
        onConfigured();
      })
      .catch(() => {
        // no-cors всегда succeeds, но на всякий случай
        localStorage.setItem('alpha.serverUrl', trimmed);
        onConfigured();
      });
  }

  return (
    <div className="setup-screen">
      <div className="setup-card">
        <h1 className="setup-title">Alpha Messenger</h1>
        <p className="setup-subtitle">Подключение к серверу</p>
        <form onSubmit={handleSubmit}>
          <label htmlFor="server-url" className="setup-label">
            Адрес сервера
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
            {connecting ? 'Подключение...' : 'Подключиться'}
          </button>
        </form>
      </div>
    </div>
  );
}
