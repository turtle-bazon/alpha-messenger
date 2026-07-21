import { useEffect, useRef, useState } from 'react';
import { getDeviceId } from '../api/session';
import type { ServerEvent } from '../api/types';
import { WsClient } from '../api/ws';
import { IconX } from '../util/icons';

// Уведомления уровня аккаунта (безопасность): новый вход / новое устройство.
// Источник — общий поток событий (auth.attempt, device.added из outbox).
//
// Тонкость реплея: при hello сервер сперва выгружает историю outbox, и только
// потом шлёт маркер 'synced'. До маркера события — это «уже было» (история),
// после — живые. Сигналим только о живых (ws.isLive()), плюс свои собственные
// события отсекаем по deviceId.

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

    // device.added приходит раньше auth.attempt (эмитятся в этом порядке) —
    // запоминаем новое устройство, чтобы обогатить текст входа.
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
