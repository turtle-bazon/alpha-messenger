import { Tray, Menu, BrowserWindow, app, nativeImage, ipcMain } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let tray: Tray | null = null;

export function setupTray(mainWindow: BrowserWindow): void {
  // Создаём иконку для трея
  const iconPath = path.join(__dirname, '../../resources/trayIcon.png');
  const icon = nativeImage.createFromPath(iconPath);

  // На macOS используем шаблонную иконку
  if (process.platform === 'darwin') {
    icon.setTemplateImage(true);
  }

  tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon);
  tray.setToolTip('Alpha Messenger');

  // Контекстное меню трея
  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Показать',
      click: () => {
        mainWindow.show();
        mainWindow.focus();
      },
    },
    { type: 'separator' },
    {
      label: 'Выход',
      click: () => {
        (app as typeof app & { isQuitting: boolean }).isQuitting = true;
        app.quit();
      },
    },
  ]);

  tray.setContextMenu(contextMenu);

  // Двойной клик по трею — показать окно
  tray.on('double-click', () => {
    mainWindow.show();
    mainWindow.focus();
  });

  // Обновляем бейдж при изменении количества непрочитанных
  ipcMain.handle('tray:badge', (_event, count: number) => {
    if (process.platform === 'darwin') {
      app.setBadgeCount(count);
    }
    tray?.setToolTip(count > 0 ? `Alpha Messenger (${count})` : 'Alpha Messenger');
  });
}
