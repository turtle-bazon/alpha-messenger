import { useEffect, useRef, useState } from 'react';
import { getDeviceId } from '../api/session';
import type { ServerEvent } from '../api/types';
import { WsClient } from '../api/ws';
import { IconX } from '../util/icons';

// Account-level (security) notifications: new sign-in / new device.
// Source: the shared event stream (auth.attempt, device.added from the outbox).
//
// Replay subtlety: on hello the server first flushes the outbox history and only
// then sends the 'synced' marker. Events before the marker are "already happened"
// (history), after it — live. We notify only about live ones (ws.isLive()), and
// filter out our own events by deviceId.

interface Notice {
  id: number;
  text: string;
  detail: string | null;
}

const HIDE_MS = 8000;

export function AccountNotifications({ ws }: { ws: WsClient }): JSX.Element {
  const [notices, setNotices] = useState<Notice[]>([]);
  const nextId = useRef(0);
  const newDevices = useRef<Set<string>>(new Set());
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => {
    const ownDevice = getDeviceId();

    const push = (text: string, detail: string | null): void => {
      const id = ++nextId.current;
      setNotices((prev) => [...prev, { id, text, detail }]);
      const t = setTimeout(() => {
        setNotices((prev) => prev.filter((n) => n.id !== id));
      }, HIDE_MS);
      timers.current.push(t);
    };

    // device.added arrives before auth.attempt (they're emitted in that order) —
    // remember the new device to enrich the sign-in text.
    const offDevice = ws.on('device.added', (ev: ServerEvent) => {
      if (!ws.isLive()) return;
      const deviceId = (ev.payload as { deviceId?: string }).deviceId;
      if (!deviceId || deviceId === ownDevice) return;
      newDevices.current.add(deviceId);
    });

    const offAuth = ws.on('auth.attempt', (ev: ServerEvent) => {
      if (!ws.isLive()) return;
      const p = ev.payload as { deviceId?: string; ip?: string | null };
      if (!p.deviceId || p.deviceId === ownDevice) return;
      const fromNewDevice = newDevices.current.has(p.deviceId);
      push(
        fromNewDevice
          ? 'Новый вход в аккаунт с нового устройства'
          : 'Новый вход в аккаунт',
        p.ip ? `IP: ${p.ip}` : null,
      );
    });

    return () => {
      offDevice();
      offAuth();
      for (const t of timers.current) clearTimeout(t);
      timers.current = [];
    };
  }, [ws]);

  function dismiss(id: number): void {
    setNotices((prev) => prev.filter((n) => n.id !== id));
  }

  return (
    <div className="account-notices" data-testid="account-notices">
      {notices.map((n) => (
        <div className="account-notice" key={n.id} data-testid="account-notice">
          <div className="account-notice-body">
            <span className="account-notice-text">{n.text}</span>
            {n.detail && (
              <span className="account-notice-detail">{n.detail}</span>
            )}
          </div>
          <button
            type="button"
            aria-label="Закрыть"
            onClick={() => dismiss(n.id)}
          >
            <IconX />
          </button>
        </div>
      ))}
    </div>
  );
}
