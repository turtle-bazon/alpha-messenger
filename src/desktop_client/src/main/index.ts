import { app, BrowserWindow, shell, protocol, net, ipcMain } from 'electron';
import path from 'path';
import fs from 'fs';
import { setupTray } from './tray';

let mainWindow: BrowserWindow | null = null;
const distPath = path.join(__dirname, '../../web_client_dist');

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
    },
  });

  // В dev режиме загружаем Vite dev server
  if (process.env.NODE_ENV === 'development') {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools();
  } else {
    // Проверяем, есть ли сохранённый URL сервера
    // Если нет — показываем экран настройки
    mainWindow.loadURL('app://setup.html');
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

// IPC: получить сохранённый URL сервера
ipcMain.handle('get-server-url', () => {
  // Читаем из localStorage через renderer
  return null;
});

// IPC: перезагрузить с web клиентом
ipcMain.handle('load-web-client', () => {
  if (mainWindow) {
    mainWindow.loadURL('app://index.html');
  }
});

// IPC: вернуться на экран настройки
ipcMain.handle('show-setup', () => {
  if (mainWindow) {
    mainWindow.loadURL('app://setup.html');
  }
});

// Готово к работе — настраиваем трей
app.whenReady().then(() => {
  // Регистрируем custom protocol для раздачи статики
  protocol.handle('app', (request) => {
    const url = new URL(request.url);
    let filePath = path.join(distPath, url.pathname);

    // Если файл не существует — fallback для SPA (index.html)
    if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      filePath = path.join(distPath, 'index.html');
    }

    return net.fetch(`file://${filePath}`);
  });

  createWindow();
  if (mainWindow) setupTray(mainWindow);

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
