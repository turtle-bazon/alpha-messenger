import { app, BrowserWindow, shell, ipcMain } from 'electron';
import path from 'path';
import { setupTray } from './tray';
import { setupNotifications } from './notifications';

let mainWindow: BrowserWindow | null = null;

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    title: 'Alpha Messenger',
    icon: path.join(__dirname, '../../resources/icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webSecurity: false, // Разрешаем localStorage и cross-origin для file://
    },
  });

  // В dev режиме загружаем Vite dev server
  if (process.env.NODE_ENV === 'development') {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools();
  } else {
    // В prod режиме загружаем setup.html или web клиент
    const setupPath = path.join(__dirname, '../../setup.html');
    const distPath = path.join(__dirname, '../../web_client_dist/index.html');
    mainWindow.loadFile(setupPath);
  }

  // Открываем внешние ссылки в браузере
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  // Сворачиваем в трей вместо закрытия
  mainWindow.on('close', (event) => {
    if (!(global as any).isQuitting) {
      event.preventDefault();
      mainWindow?.hide();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// IPC: перезагрузить с web клиентом
ipcMain.handle('load-web-client', () => {
  if (mainWindow) {
    const distPath = path.join(__dirname, '../../web_client_dist/index.html');
    mainWindow.loadFile(distPath);
  }
});

// IPC: вернуться на экран настройки
ipcMain.handle('show-setup', () => {
  if (mainWindow) {
    const setupPath = path.join(__dirname, '../../setup.html');
    mainWindow.loadFile(setupPath);
  }
});

// IPC: установить badge на иконке (вызывается из renderer при обновлении unread)
ipcMain.handle('app:setBadgeCount', (_event, count: number) => {
  if (process.platform !== 'win32') {
    app.setBadgeCount(count);
  }
  // Tooltip обновляется в tray.ts
});

// Готово к работе — настраиваем трей и уведомления
app.whenReady().then(() => {
  createWindow();
  if (mainWindow) {
    setupTray(mainWindow);
    setupNotifications(mainWindow);
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    } else {
      mainWindow?.show();
    }
  });
});

// Выход при закрытии всех окон (macOS)
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// Флаг для выхода из трея
app.on('before-quit', () => {
  (global as any).isQuitting = true;
});

export { mainWindow };
