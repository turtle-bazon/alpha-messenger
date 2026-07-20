import { Notification, BrowserWindow, app, ipcMain } from 'electron';
import { execFile } from 'child_process';
import path from 'path';
import os from 'os';

let mainWindow: BrowserWindow | null = null;

const isLinux = os.platform() === 'linux';

export function setupNotifications(window: BrowserWindow): void {
  mainWindow = window;

  // IPC: показать нативное уведомление
  ipcMain.handle(
    'notification:show',
    (_event, title: string, body: string, icon?: string) => {
      if (isLinux) {
        showLinuxNotification(title, body, icon);
      } else {
        showElectronNotification(title, body, icon);
      }
    },
  );

  // IPC: проверить поддержку уведомлений
  ipcMain.handle('notification:supported', () => {
    if (isLinux) return true; // notify-send есть в любой Linux DE
    return Notification.isSupported();
  });
}

/**
 * Linux: notify-send (libnotify) — уведомления попадают в KDE/GNOME центр.
 */
function showLinuxNotification(
  title: string,
  body: string,
  icon?: string,
): void {
  const iconPath = icon ?? path.join(__dirname, '../../resources/icon.png');
  const args = [
    '--app-name=Alpha',
    `--icon=${iconPath}`,
    title,
    body,
  ];

  execFile('notify-send', args, (err) => {
    if (err) {
      // Fallback на Electron Notification если notify-send недоступен
      console.warn('notify-send failed, falling back to Electron:', err.message);
      showElectronNotification(title, body, icon);
    }
  });
}

/**
 * Non-Linux (macOS/Windows): Electron Notification API.
 */
function showElectronNotification(
  title: string,
  body: string,
  icon?: string,
): void {
  if (!Notification.isSupported()) return;

  const notif = new Notification({
    title,
    body,
    icon: icon ?? path.join(__dirname, '../../resources/icon.png'),
    silent: false,
  });

  notif.on('click', () => {
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    }
    mainWindow?.webContents.send('notification:click');
  });

  notif.show();
}
