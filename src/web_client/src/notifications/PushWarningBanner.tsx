import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { shouldShowPushWarning } from './push';
import { IconX } from '../util/icons';

/**
 * Warning banner about push notifications being unavailable.
 * Shown on Android when neither FCM nor UnifiedPush is available.
 */
export function PushWarningBanner(): JSX.Element | null {
  const { t } = useTranslation();
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
        <span>{t("push.unavailable")}</span>
        <button
          type="button"
          className="push-warning-close"
          onClick={() => setVisible(false)}
          aria-label={t("common.close")}
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
          {t('push.details')}
        </button>
      )}
      {expanded && (
        <div className="push-warning-content">
          <p>{t('push.noBackground')}</p>
          <p>
            {t('push.installNtfy')} <strong>ntfy</strong> — {t('push.ntfyWhat')}
          </p>
          <ol>
            <li>{t('push.step1')}</li>
            <li>{t('push.step2')}</li>
            <li>{t('push.step3')}</li>
          </ol>
          <p>
            <a
              href="https://unifiedpush.org"
              target="_blank"
              rel="noopener noreferrer"
            >
              {t('push.learnMore')}
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
              {t('push.check')}
            </button>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => setVisible(false)}
            >
              {t('push.skip')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
