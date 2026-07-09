import { Tray, Menu, BrowserWindow, app, nativeImage, ipcMain, NativeImage } from 'electron';
import path from 'path';

let tray: Tray | null = null;
let baseIcon: NativeImage | null = null;
let currentBadgeCount = 0;

// Генерирует иконку трея с бейджем (число поверх основной иконки)
function createBadgeIcon(count: number): NativeImage {
  if (!baseIcon || count <= 0) return baseIcon ?? nativeImage.createEmpty();

  // Создаём Canvas через offscreen window (Electron не имеет нативного Canvas)
  // Используем простой подход: рисуем красный кружок с числом
  const size = baseIcon.getSize();
  const badgeSize = Math.round(size.width * 0.45);
  const badge = nativeImage.createEmpty();

  // На Linux генерируем PNG с бейджем через temp файл
  // Используем ImageMagick если доступен, иначе возвращаем базовую иконку
  try {
    const tmpFile = `/tmp/tray_badge_${Date.now()}.png`;
    const baseFile = path.join(__dirname, '../../resources/trayIcon.png');

    // Простой badge: красный кружок с белым числом
    // Для Linux используем overlay через setToolTip (OLTIP)
    // Полноценный badge требует Canvas или ImageMagick
    return baseIcon;
  } catch {
    return baseIcon;
  }
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
    currentBadgeCount = count;
    // Tooltip с количеством
    tray?.setToolTip(count > 0 ? `Alpha Messenger (${count})` : 'Alpha Messenger');
  });

  // Overlay icon для Windows (красный кружок с числом)
  ipcMain.handle('tray:overlay', (_event, count: number) => {
    if (process.platform === 'win32' && mainWindow) {
      if (count <= 0) {
        mainWindow.setOverlayIcon(null, '');
        return;
      }
      // На Windows используем setOverlayIcon с иконкой
      // Пока пропускаем - нужен .ico файл
    }
  });
}
