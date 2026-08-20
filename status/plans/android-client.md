# Android-клиент (Capacitor)

## Статус: СДЕЛАНО

## Завершено
- [x] Исследование структуры web_client и desktop_client
- [x] Создание `src/android_client/` с package.json, capacitor.config.ts, tsconfig.json
- [x] Push-детект: FCM → UnifiedPush → none (с предупреждением)
- [x] `web_client/src/notifications/push.ts` — типы и логика push-регистрации
- [x] `web_client/src/notifications/PushWarningBanner.tsx` — баннер с инструкцией по UP
- [x] `web_client/src/util/platform.ts` — детект платформы, init
- [x] Интеграция в `App.tsx`: initPlatform() + PushWarningBanner
- [x] CSS для баннера
- [x] Серверная часть: multi-platform отправка — сделана через колонку
      `provider` ('fcm'/'unifiedpush') в существующей `push_subscriptions`
      (миграция 0001) и `sendWakeUp` в server/src/push.ts (FCM HTTP v1 +
      UnifiedPush/ntfy), отдельная таблица push_tokens не понадобилась
- [x] npm install в android_client
- [x] Capacitor sync (генерация android/)
- [x] Сборка APK — через CI (.github/workflows/android-build.yml, release-подпись)
- [x] Тест на реальном устройстве (Transsion); проблема блокировки broadcast'ов
      на Griffin — отдельный blocked-пункт, не относится к сборке клиента

## Файлы
- `src/android_client/` — Capacitor проект
- `src/web_client/src/notifications/push.ts` — push логика
- `src/web_client/src/notifications/PushWarningBanner.tsx` — UI предупреждения
- `src/web_client/src/util/platform.ts` — платформо-зависимая логика
- `src/web_client/src/App.tsx` — интеграция
- `src/server/src/push.ts` — multi-platform отправка пушей
