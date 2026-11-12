import { Tray, Menu, BrowserWindow, app, nativeImage, ipcMain, NativeImage } from 'electron';
import path from 'path';

let tray: Tray | null = null;
let baseIcon: NativeImage | null = null;
let currentBadgeColor: 'red' | 'blue' | null = null;
let pendingBadgeColor: 'red' | 'blue' | null = null;
let hasPendingBadge = false;

function badgeIconPath(color: 'red' | 'blue' | null): string {
  if (!color) return path.join(__dirname, '../../resources/trayIcon.png');
  return path.join(__dirname, `../../resources/trayIcon-badge-${color}.png`);
}

export function applyTrayBadge(color: 'red' | 'blue' | null): void {
  currentBadgeColor = color;
  pendingBadgeColor = color;
  hasPendingBadge = true;
  if (!tray) return;
  const icon = nativeImage.createFromPath(badgeIconPath(color));
  if (!icon.isEmpty()) tray.setImage(icon);
  tray.setToolTip(
    color === 'red'
      ? 'Alpha Messenger — новые сообщения'
      : color === 'blue'
        ? 'Alpha Messenger — новые сообщения в группах'
        : 'Alpha Messenger',
  );
}

export function setupTray(mainWindow: BrowserWindow): void {
  // Создаём иконку для трея
  const iconPath = path.join(__dirname, '../../resources/trayIcon.png');
  baseIcon = nativeImage.createFromPath(iconPath);

  // На macOS используем шаблонную иконку
  if (process.platform === 'darwin') {
    baseIcon.setTemplateImage(true);
  }

  tray = new Tray(baseIcon.isEmpty() ? nativeImage.createEmpty() : baseIcon);
  tray.setToolTip('Alpha Messenger');
  if (hasPendingBadge) applyTrayBadge(pendingBadgeColor);

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

  // Цветовой бейдж: red/blue/null
  ipcMain.handle('tray:setBadgeColor', (_event, color: 'red' | 'blue' | null) => {
    applyTrayBadge(color);
  });

  // Обратная совместимость: старый числовой бейдж → красный кружок
  ipcMain.handle('tray:badge', (_event, count: number) => {
    applyTrayBadge(count > 0 ? 'red' : null);
  });
}
