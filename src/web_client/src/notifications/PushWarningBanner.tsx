import { useState, useEffect } from 'react';
import { shouldShowPushWarning } from './push';
import { IconX } from '../util/icons';

/**
 * Warning banner about push notifications being unavailable.
 * Shown on Android when neither FCM nor UnifiedPush is available.
 */
export function PushWarningBanner(): JSX.Element | null {
  const [visible, setVisible] = useState(false);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    setVisible(shouldShowPushWarning());
    // Listen for the android-setup event: initAndroid() sets the flag after first render
    const handler = () => setVisible(shouldShowPushWarning());
    window.addEventListener('push-warning-changed', handler);
    return () => window.removeEventListener('push-warning-changed', handler);
  }, []);

  if (!visible) return null;

  return (
    <div className="push-warning-banner" data-testid="push-warning">
      <div className="push-warning-header">
        <span>Уведомления недоступны</span>
        <button
          type="button"
          className="push-warning-close"
          onClick={() => setVisible(false)}
          aria-label="Закрыть"
        >
          <IconX />
        </button>
      </div>
      {!expanded && (
        <button
          type="button"
          className="push-warning-details"
          onClick={() => setExpanded(true)}
        >
          Подробнее
        </button>
      )}
      {expanded && (
        <div className="push-warning-content">
          <p>
            Вы не будете получать уведомления после закрытия приложения.
          </p>
          <p>
            Для получения уведомлений установите{' '}
            <strong>ntfy</strong> — бесплатное приложение для push-уведомлений
            через UnifiedPush.
          </p>
          <ol>
            <li>Установите ntfy из F-Droid или GitHub</li>
            <li>Откройте ntfy и выберите сервер</li>
            <li>Вернитесь в Alpha и нажмите «Проверить»</li>
          </ol>
          <p>
            <a
              href="https://unifiedpush.org"
              target="_blank"
              rel="noopener noreferrer"
            >
              Узнать больше о UnifiedPush
            </a>
          </p>
          <div className="push-warning-actions">
            <button
              type="button"
              className="btn-primary"
              onClick={() => {
                // Re-registration — invoked from android_client when available
                window.location.reload();
              }}
            >
              Проверить
            </button>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => setVisible(false)}
            >
              Пропустить
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
