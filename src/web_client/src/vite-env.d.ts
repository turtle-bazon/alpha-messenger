/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

// Electron desktop API (from preload.ts)
interface ElectronAPI {
  showNotification: (title: string, body: string, icon?: string) => Promise<void>;
  minimize: () => Promise<void>;
  maximize: () => Promise<void>;
  close: () => Promise<void>;
  focus: () => Promise<void>;
  setTrayTooltip: (tooltip: string) => Promise<void>;
  setTrayBadge: (count: number) => Promise<void>;
  setBadgeCount: (count: number) => Promise<void>;
  getVersion: () => Promise<string>;
  getPlatform: () => Promise<string>;
  loadWebClient: () => Promise<void>;
  showSetup: () => Promise<void>;
  onNotificationClick: (callback: () => void) => void;
}

interface Window {
  electronAPI?: ElectronAPI;
}
