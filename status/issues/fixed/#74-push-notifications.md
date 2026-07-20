# #74 — Push-уведомления через FCM / UnifiedPush

## Описание
Push-уведомления сейчас — стаб на сервере (`sendWakeUp` только логирует). Нужно реализовать реальную доставку push-уведомлений через FCM и UnifiedPush. UnifiedPush — дефолт, FCM — фолбэк.

## Решение

### Клиент (android-setup.ts)
- **REST API**: добавлены `subscribePush()` и `unsubscribePush()` в `rest.ts`
- **Регистрация**: автоматический выбор UP → FCM, отправка токена на сервер через `POST /api/push/subscriptions`
- **Device ID**: генерируется через `crypto.randomUUID()`, хранится в localStorage
- **UnifiedPush**: проверка `Capacitor.Plugins.UnifiedPush` для нативного, фолбэк на Web Push API
- **FCM**: через `@capacitor/push-notifications` (как было), с запросом разрешений

### Сервер (push.ts)
- **FCM HTTP v1 API**: JWT-авторизация через сервисный аккаунт Google, отправка через `https://fcm.googleapis.com/v1/projects/{project}/messages:send`
- **UnifiedPush (ntfy)**: отправка через `POST {endpoint}` с JSON `{ topic, message, priority }`
- **Очистка**: при 404/410 — удаление недействительной подписки из БД
- **Конфигурация**: `FCM_PROJECT_ID`, `FCM_SERVICE_ACCOUNT_KEY`, `UP_SERVER`, `UP_TOPIC_PREFIX`

### Не сделано (future)
- UI выбора UP-провайдера если их несколько (→ #67)
- Отправка при logout (пока не удаляем подписку)
