import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { getDeviceId } from './api/session';
import { getDevices, deleteDevice, deleteAllDevices, type DeviceInfo } from './api/rest';
import { IconArrowLeft, IconMonitor, IconSmartphone, IconTrash } from './util/icons';
import { intlLocale } from './i18n';

interface DevicesScreenProps {
  onBack: () => void;
}

export function DevicesScreen({ onBack }: DevicesScreenProps): JSX.Element {
  const { t } = useTranslation();
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
      setError(t('devices.loadFailed'));
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
      setError(t('devices.deleteFailed'));
    }
  }

  async function handleDeleteAll(): Promise<void> {
    try {
      await deleteAllDevices();
      setDevices(devices.filter(d => d.deviceId === currentDeviceId));
      setConfirmDeleteAll(false);
    } catch (e) {
      setError(t('devices.deleteAllFailed'));
    }
  }

  function formatDate(dateStr: string): string {
    const date = new Date(dateStr);
    return date.toLocaleDateString(intlLocale(), {
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
    // Simple heuristic to determine device type
    // Device type info from the server could be added later
    return <IconSmartphone />;
  }

  function getDeviceLabel(deviceId: string): string {
    if (deviceId === currentDeviceId) {
      return t('devices.current');
    }
    return t('devices.device');
  }

  if (loading) {
    return (
      <div className="settings-screen" data-testid="devices-screen">
        <header className="settings-header">
          <button
            type="button"
            className="icon-button settings-back"
            onClick={onBack}
            aria-label={t("common.back")}
          >
            <IconArrowLeft />
          </button>
          <span className="settings-header-title">{t("settings.devices")}</span>
        </header>
        <div className="settings-items">
          <div className="settings-hint">{t("common.loading")}</div>
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
          aria-label={t("common.back")}
        >
          <IconArrowLeft />
        </button>
        <span className="settings-header-title">{t("settings.devices")}</span>
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
                  {device.lastSeenAt && `${t("devices.lastSeen")} ${formatDate(device.lastSeenAt)}`}
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
                      {t('common.delete')}
                    </button>
                    <button
                      type="button"
                      className="settings-toggle"
                      onClick={() => setConfirmDelete(null)}
                    >
                      {t('common.cancel')}
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    className="icon-button"
                    onClick={() => setConfirmDelete(device.deviceId)}
                    aria-label={t("devices.deleteDevice")}
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
              <span>{t("devices.deleteAllConfirm")}</span>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button
                  type="button"
                  className="settings-toggle"
                  onClick={() => void handleDeleteAll()}
                  style={{ color: 'var(--danger)' }}
                >
                  {t('common.delete')}
                </button>
                <button
                  type="button"
                  className="settings-toggle"
                  onClick={() => setConfirmDeleteAll(false)}
                >
                  {t('common.cancel')}
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
              <span className="settings-row-text">{t("devices.deleteAllOthers")}</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}
