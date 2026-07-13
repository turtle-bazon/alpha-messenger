# Android-клиент (Capacitor)

## Статус: В РАБОТЕ

## Завершено
- [x] Исследование структуры web_client и desktop_client
- [x] Создание `src/android_client/` с package.json, capacitor.config.ts, tsconfig.json
- [x] Push-детект: FCM → UnifiedPush → none (с предупреждением)
- [x] `web_client/src/notifications/push.ts` — типы и логика push-регистрации
- [x] `web_client/src/notifications/PushWarningBanner.tsx` — баннер с инструкцией по UP
- [x] `web_client/src/util/platform.ts` — детект платформы, init
- [x] Интеграция в `App.tsx`: initPlatform() + PushWarningBanner
- [x] CSS для баннера

## В РАБОТЕ
- [ ] Серверная часть: push_tokens таблица, multi-platform отправка

## Осталось
- [ ] npm install в android_client (нужен Android SDK)
- [ ] Capacitor sync (генерация android/)
- [ ] Сборка APK
- [ ] Тест на реальном устройстве

## Файлы
- `src/android_client/` — Capacitor проект
- `src/web_client/src/notifications/push.ts` — push логика
- `src/web_client/src/notifications/PushWarningBanner.tsx` — UI предупреждения
- `src/web_client/src/util/platform.ts` — платформо-зависимая логика
- `src/web_client/src/App.tsx` — интеграция
