import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { getPermission, requestPermission, setNotifBrowser } from '../util/notifications';
import { runPushTest, type PushTestOutcome } from './webpush';

type Status =
  | { kind: 'idle' }
  | { kind: 'running' }
  | { kind: 'done'; outcome: PushTestOutcome }
  | { kind: 'denied' }
  | { kind: 'error' };

// "Check notifications": the server pushes a test notification to this very
// device, and the row tells what happened to it — no need to ask someone in a
// chat to write. Two halves are reported separately, as they fail separately:
// whether the push service accepted the push, and whether it came back to this
// device (the service worker echoes it to the page; web only).
export function PushTestRow({ onPermission }: { onPermission?: (p: NotificationPermission) => void }): JSX.Element {
  const { t } = useTranslation();
  const [status, setStatus] = useState<Status>({ kind: 'idle' });

  async function run(): Promise<void> {
    // The click is the user gesture the permission prompt needs — ask first,
    // before anything async eats the activation.
    if (getPermission() === 'default') {
      const p = await requestPermission();
      onPermission?.(p);
      if (p === 'granted') setNotifBrowser(true);
    }
    if (getPermission() === 'denied' && !(window as any).Capacitor?.isNativePlatform?.()) {
      setStatus({ kind: 'denied' });
      return;
    }
    setStatus({ kind: 'running' });
    try {
      setStatus({ kind: 'done', outcome: await runPushTest() });
    } catch (err) {
      console.warn('Alpha: push test failed', err);
      setStatus({ kind: 'error' });
    }
  }

  return (
    <>
      <button
        type="button"
        className="settings-row settings-row--button"
        data-testid="push-test"
        disabled={status.kind === 'running'}
        onClick={() => void run()}
      >
        <span className="settings-row-text">{t('pushTest.button')}</span>
      </button>
      {status.kind !== 'idle' && (
        <div
          className={'settings-hint push-test-result push-test-result--' + verdict(status)}
          data-testid="push-test-result"
          data-verdict={verdict(status)}
        >
          {describe(status, t)}
        </div>
      )}
    </>
  );
}

type Verdict = 'pending' | 'ok' | 'warn' | 'fail';

function verdict(s: Status): Verdict {
  if (s.kind === 'running' || s.kind === 'idle') return 'pending';
  if (s.kind !== 'done') return 'fail';
  const o = s.outcome;
  if (o.received === true) return 'ok';
  if (o.results.some((r) => r.success)) return o.received === null ? 'ok' : 'warn';
  return 'fail';
}

function describe(s: Status, t: (k: string, o?: Record<string, unknown>) => string): string {
  switch (s.kind) {
    case 'running':
      return t('pushTest.running');
    case 'denied':
      return t('settings.denied');
    case 'error':
      return t('pushTest.error');
    case 'idle':
      return '';
  }
  const o = s.outcome;
  if (o.state === 'needs-install') return t('pushTest.needsInstall');
  if (o.state === 'unsupported') return t('settings.notSupported');
  if (o.state === 'no-permission') return t('settings.denied');
  if (o.state === 'failed') return t('pushTest.subscribeFailed');
  if (o.results.length === 0) return t('pushTest.noChannel');
  if (o.received === true) return t('pushTest.received');
  const accepted = o.results.find((r) => r.success);
  if (accepted) {
    return o.received === null
      ? t('pushTest.nativeAccepted')
      : t('pushTest.acceptedNotReceived');
  }
  const r = o.results[0];
  const code = r.statusCode !== undefined ? `HTTP ${r.statusCode}` : (r.message ?? '—');
  return t(r.removed ? 'pushTest.removed' : 'pushTest.rejected', { code });
}
