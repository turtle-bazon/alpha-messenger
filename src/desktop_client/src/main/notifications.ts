import { Notification, BrowserWindow, app, ipcMain } from 'electron';
import path from 'path';

let mainWindow: BrowserWindow | null = null;

export function setupNotifications(window: BrowserWindow): void {
  mainWindow = window;

  // IPC: показать нативное уведомление
  ipcMain.handle(
    'notification:show',
    (_event, title: string, body: string, icon?: string) => {
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
        // Уведомляем renderer о клике
        mainWindow?.webContents.send('notification:click');
      });

      notif.show();
    },
  );

  // IPC: проверить поддержку уведомлений
  ipcMain.handle('notification:supported', () => {
    return Notification.isSupported();
  });
}
