# #74 — Push-уведомления через FCM / UnifiedPush

## Описание
Push-уведомления сейчас — стаб на сервере (`sendWakeUp` только логирует). Нужно реализовать реальную доставку push-уведомлений через FCM и UnifiedPush. UnifiedPush — дефолт, FCM — фолбэк.

## Архитектура

### Клиент
- Регистрация push-подписки при входе (уже есть `POST /api/push/subscriptions`)
- UnifiedPush: клиент подключается к ntfy/serverу, получает endpoint, шлёт на сервер
- FCM: клиент получает FCM-токен через `@capacitor/push-notifications`, шлёт на сервер
- Автоматический выбор платформы: если UnifiedPush доступен → он, иначе → FCM
- При logout — удаление подписки

### Сервер
- `sendWakeUp()` — реальная отправка push через FCM HTTP v1 API и/или UnifiedPush
- Определение провайдера по полю `provider` в `push_subscriptions`
- Тело push: `{ title, body, click_action }` (wake-up only, без данных — как в архитектуре)
- Обработка ошибок доставки (410 Gone → удаление подписки)

### FCM
- Сервисный аккаунт Google с ключом
- HTTP v1 API (`https://fcm.googleapis.com/v1/projects/{project}/messages:send`)
- Токен доступа через JWT

### UnifiedPush
- Дистрибьютор: ntfy.sh или self-hosted ntfy
- API: `POST https://ntfy.sh/{topic}` с JSON-телом
- Дистрибьютор-agnostic: работаем с любым UP-совместимым сервером

## Приоритет
Critical — без push на мобильных устройствах приложение неполноценно.

## Контекст
- Подписки уже хранятся в БД (`push_subscriptions`)
- `sendWakeUp()` уже вызывается из `ws.ts` при отсутствии активного WS
- На клиенте уже есть `push.ts` с detects_platform, `PushWarningBanner`
- Android: `@capacitor/push-notifications` уже установлен
