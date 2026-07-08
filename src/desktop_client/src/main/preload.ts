import { contextBridge, ipcRenderer } from 'electron';

// Безопасный IPC bridge для renderer process
contextBridge.exposeInMainWorld('electronAPI', {
  // Уведомления
  showNotification: (title: string, body: string, icon?: string) =>
    ipcRenderer.invoke('notification:show', title, body, icon),

  // Окно
  minimize: () => ipcRenderer.invoke('window:minimize'),
  maximize: () => ipcRenderer.invoke('window:maximize'),
  close: () => ipcRenderer.invoke('window:close'),
  focus: () => ipcRenderer.invoke('window:focus'),

  // Трей
  setTrayTooltip: (tooltip: string) => ipcRenderer.invoke('tray:tooltip', tooltip),
  setTrayBadge: (count: number) => ipcRenderer.invoke('tray:badge', count),

  // Информация о приложении
  getVersion: () => ipcRenderer.invoke('app:version'),
  getPlatform: () => ipcRenderer.invoke('app:platform'),

  // События
  onNotificationClick: (callback: () => void) => {
    ipcRenderer.on('notification:click', () => callback());
  },
});
