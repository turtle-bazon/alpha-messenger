// Декларации Capacitor модулей для TypeScript.
// Используются только для type-checking, не добавляют runtime зависимостей.
// В реальности модули доступны только в Capacitor-сборке.

declare module '@capacitor/app' {
  export const App: {
    addListener(event: string, cb: (data: any) => void): Promise<{ remove(): void }>;
  };
}

declare module '@capacitor/push-notifications' {
  export const PushNotifications: {
    checkPermissions(): Promise<{ receive: string }>;
    requestPermissions(): Promise<{ receive: string }>;
    register(): Promise<void>;
    addListener(event: string, cb: (data: any) => void): Promise<{ remove(): void }>;
  };
}
