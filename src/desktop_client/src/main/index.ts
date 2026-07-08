import { app, BrowserWindow, shell, protocol } from 'electron';
import path from 'path';
import fs from 'fs';
import { setupTray } from './tray';

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
    },
  });

  // В dev режиме загружаем Vite dev server
  if (process.env.NODE_ENV === 'development') {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools();
  } else {
    // В prod режиме загружаем built SPA через custom protocol
    mainWindow.loadURL('app://index.html');
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

// Готово к работе — настраиваем трей
app.whenReady().then(() => {
  // Регистрируем custom protocol для раздачи статики
  protocol.handle('app', (request) => {
    const filePath = path.join(__dirname, '../../web_client_dist', new URL(request.url).pathname);
    if (fs.existsSync(filePath)) {
      return new Response(fs.readFileSync(filePath));
    }
    // Fallback для SPA — все маршруты → index.html
    return new Response(fs.readFileSync(path.join(__dirname, '../../web_client_dist/index.html')));
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
