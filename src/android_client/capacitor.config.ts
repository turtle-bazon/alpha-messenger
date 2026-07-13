import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'ru.bazon.alpha.messenger',
  appName: 'Alpha',
  webDir: 'www',
  server: {
    // В продакшене: загружаем bundled index.html из assets
    // В dev: можно переключить на http://localhost:5173
    androidScheme: 'https',
  },
  plugins: {
    PushNotifications: {
      // FCM и UnifiedPush обрабатываются на клиенте
      presentationOptions: ['badge', 'sound', 'alert'],
    },
  },
};

export default config;
