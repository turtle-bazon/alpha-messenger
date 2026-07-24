import { useState, useEffect } from 'react';
import { getDeviceId } from './api/session';
import { getDevices, deleteDevice, deleteAllDevices, type DeviceInfo } from './api/rest';
import { IconArrowLeft, IconMonitor, IconSmartphone, IconTrash } from './util/icons';

interface DevicesScreenProps {
  onBack: () => void;
}

export function DevicesScreen({ onBack }: DevicesScreenProps): JSX.Element {
  const [devices, setDevices] = useState<DeviceInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [confirmDeleteAll, setConfirmDeleteAll] = useState(false);

  const currentDeviceId = getDeviceId();

  useEffect(() => {
    loadDevices();
  }, []);

  async function loadDevices(): Promise<void> {
    try {
      setLoading(true);
      const data = await getDevices();
      setDevices(data.devices);
    } catch (e) {
      setError('Не удалось загрузить устройства');
    } finally {
      setLoading(false);
    }
  }

  async function handleDelete(deviceId: string): Promise<void> {
    try {
      await deleteDevice(deviceId);
      setDevices(devices.filter(d => d.deviceId !== deviceId));
      setConfirmDelete(null);
    } catch (e) {
      setError('Не удалось удалить устройство');
    }
  }

  async function handleDeleteAll(): Promise<void> {
    try {
      await deleteAllDevices();
      setDevices(devices.filter(d => d.deviceId === currentDeviceId));
      setConfirmDeleteAll(false);
    } catch (e) {
      setError('Не удалось удалить устройства');
    }
  }

  function formatDate(dateStr: string): string {
    const date = new Date(dateStr);
    return date.toLocaleDateString('ru-RU', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  function getDeviceIcon(deviceId: string): JSX.Element {
    if (deviceId === currentDeviceId) {
      return <IconMonitor />;
    }
    // Простая эвристика для определения типа устройства
    // В будущем можно добавить информацию о типе устройства от сервера
    return <IconSmartphone />;
  }

  function getDeviceLabel(deviceId: string): string {
    if (deviceId === currentDeviceId) {
      return 'Это устройство';
    }
    return 'Устройство';
  }

  if (loading) {
    return (
      <div className="settings-screen" data-testid="devices-screen">
        <header className="settings-header">
          <button
            type="button"
            className="icon-button settings-back"
            onClick={onBack}
            aria-label="Назад"
          >
            <IconArrowLeft />
          </button>
          <span className="settings-header-title">Устройства</span>
        </header>
        <div className="settings-items">
          <div className="settings-hint">Загрузка...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="settings-screen" data-testid="devices-screen">
      <header className="settings-header">
        <button
          type="button"
          className="icon-button settings-back"
          onClick={onBack}
          aria-label="Назад"
        >
          <IconArrowLeft />
        </button>
        <span className="settings-header-title">Устройства</span>
      </header>

      {error && (
        <div className="settings-hint" style={{ color: 'var(--danger)' }}>
          {error}
        </div>
      )}

      <div className="settings-items">
        {devices.map(device => (
          <div
            key={device.deviceId}
            className="settings-row"
            style={{ justifyContent: 'space-between' }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <span className="settings-row-icon">
                {getDeviceIcon(device.deviceId)}
              </span>
              <div>
                <div>{getDeviceLabel(device.deviceId)}</div>
                <div className="settings-hint" style={{ margin: 0 }}>
                  {formatDate(device.createdAt)}
                  {device.lastSeenAt && ` • Последний вход: ${formatDate(device.lastSeenAt)}`}
                </div>
              </div>
            </div>

            {device.deviceId !== currentDeviceId && (
              <>
                {confirmDelete === device.deviceId ? (
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button
                      type="button"
                      className="settings-toggle"
                      onClick={() => void handleDelete(device.deviceId)}
                      style={{ color: 'var(--danger)' }}
                    >
                      Удалить
                    </button>
                    <button
                      type="button"
                      className="settings-toggle"
                      onClick={() => setConfirmDelete(null)}
                    >
                      Отмена
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    className="icon-button"
                    onClick={() => setConfirmDelete(device.deviceId)}
                    aria-label="Удалить устройство"
                    style={{ color: 'var(--danger)' }}
                  >
                    <IconTrash />
                  </button>
                )}
              </>
            )}
          </div>
        ))}
      </div>

      {devices.length > 1 && (
        <div className="settings-items" style={{ marginTop: '16px' }}>
          {confirmDeleteAll ? (
            <div className="settings-row" style={{ justifyContent: 'space-between' }}>
              <span>Удалить все кроме текущего?</span>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button
                  type="button"
                  className="settings-toggle"
                  onClick={() => void handleDeleteAll()}
                  style={{ color: 'var(--danger)' }}
                >
                  Удалить
                </button>
                <button
                  type="button"
                  className="settings-toggle"
                  onClick={() => setConfirmDeleteAll(false)}
                >
                  Отмена
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              className="settings-row settings-row--button"
              onClick={() => setConfirmDeleteAll(true)}
              style={{ color: 'var(--danger)' }}
            >
              <span className="settings-row-icon"><IconTrash /></span>
              <span className="settings-row-text">Удалить все остальные устройства</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}
