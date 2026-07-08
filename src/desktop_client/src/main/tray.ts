import { Tray, Menu, BrowserWindow, app, nativeImage, ipcMain } from 'electron';
import path from 'path';

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
        (global as any).isQuitting = true;
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
    // Linux/Unity и macOS
    if (process.platform !== 'win32') {
      app.setBadgeCount(count);
    }
    // Tooltip
    tray?.setToolTip(count > 0 ? `Alpha Messenger (${count})` : 'Alpha Messenger');
  });

  // Overlay icon для Windows ( красный кружок с числом)
  ipcMain.handle('tray:overlay', (_event, count: number) => {
    if (process.platform === 'win32' && mainWindow) {
      if (count <= 0) {
        mainWindow.setOverlayIcon(null, '');
        return;
      }
      // Генерируем иконку с бейджем программно
      const size = 16;
      const canvas = `
        <svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">
          <circle cx="8" cy="8" r="8" fill="#FF3B30"/>
          <text x="8" y="12" text-anchor="middle" fill="white" font-size="10" font-weight="bold" font-family="Arial">${count > 99 ? '99+' : count}</text>
        </svg>`;
      // electron не поддерживает SVG overlay, поэтому используем setOverlayIcon только если есть PNG
      // Пока пропускаем - на Windows badge не будет (нет нативной поддержки без .ico)
    }
  });
}
