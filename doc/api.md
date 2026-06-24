# API

Контракт серверного API. Транспортные решения и обоснования — в [architecture.md](./architecture.md).

Базовые принципы:

* Действия клиента — REST поверх HTTP. Поток событий сервер→клиент — один SSE-канал (`GET /events`).
* Аутентификация — bearer-токен в заголовке `Authorization: Bearer <token>`.
* Тело сообщения для сервера непрозрачно: это `ciphertext`-blob, сервер не знает открытого текста (см. [encryption.md](./encryption.md)). В v1 шифрования ещё нет, но контракт уже исходит из того, что сервер текста не видит.
* Все идентификаторы — строки. Время — ISO-8601 UTC.

> Статус: черновик v1. Поля помечены как обязательные минимально необходимые; список будет уточняться по мере реализации endpoint-ов.

## Аутентификация и устройства

Аутентификация v1 — упрощённая: открытая саморегистрация по `username` + `password`, без подтверждений и без registration secret. Реальные ключи device/account встанут на это место позже без слома контракта (см. encryption.md). Пароль хранится только в виде хэша (argon2id).

### POST /auth/register
Создание учётной записи. Открыта для всех (саморегистрация).
* Тело: `{ "username": "...", "password": "...", "deviceId": "<uuid>" }`
* `username` неизменяем после создания.
* Сразу выполняет авто-логин и регистрирует устройство.
* Ответ: `{ "userId": "...", "username": "...", "accessToken": "..." }`

### POST /auth/login
* Тело: `{ "username": "...", "password": "...", "deviceId": "<uuid>" }`
* Токен — это сессия, привязанная к паре `(аккаунт, устройство)`.
* Незнакомый `deviceId` авто-регистрируется как новое устройство аккаунта; при этом эмитятся события `device.added` и `auth.attempt` (см. поток событий).
* Ответ: `{ "accessToken": "...", "userId": "..." }`

### POST /devices
Явная регистрация устройства текущего аккаунта (обычно не требуется — устройство регистрируется само при логине). Оставлено для будущей привязки ключа устройства.
* Тело: `{ "deviceId": "<uuid>", "devicePublicKey": "..." }`
* Ответ: `{ "deviceId": "..." }`

### GET /me
* Ответ: `{ "userId": "...", "username": "...", "devices": [...] }`

## Чаты

### GET /chats
Список чатов аккаунта. Возвращает минимум, достаточный для рендера превью без открытия чата.
* Ответ: массив объектов чата:
```
{
  "chatId": "...",
  "type": "direct" | "group",
  "title": "...",            // для группы
  "participants": ["...", ...],
  "lastMessage": {           // null, если сообщений ещё нет
    "messageId": "...",
    "senderId": "...",
    "ciphertext": "...",
    "ts": "2026-06-24T20:00:00Z",
    "seq": 12345
  },
  "unreadCount": 3,
  "updatedAt": "2026-06-24T20:00:00Z"
}
```

### POST /chats
Создание чата.
* Тело (direct): `{ "type": "direct", "username": "..." }`
* Тело (group): `{ "type": "group", "title": "...", "members": ["...", ...] }`
* Ответ: объект чата.

### GET /chats/{chatId}
* Ответ: объект чата с расширенными деталями.

### GET /chats/{chatId}/messages
Ленивая подгрузка истории, обратный хронологический порядок (от новых к старым), пагинация по курсору.
* Query: `before={seq|messageId}` (необязательно, для следующей страницы вглубь истории), `limit=N`.
* Ответ:
```
{
  "messages": [ { "messageId", "senderId", "ciphertext", "ts", "seq", "editedAt", "deleted" }, ... ],
  "hasMore": true,
  "nextBefore": "<seq>"
}
```

### POST /chats/{chatId}/messages
Отправка сообщения.
* Тело: `{ "clientMessageId": "...", "ciphertext": "..." }`
* `clientMessageId` обеспечивает идемпотентность (повторная отправка с тем же id не создаёт дубликат) и оптимистичный UI.
* Ответ: `{ "messageId": "...", "clientMessageId": "...", "ts": "...", "seq": ... }`

### PATCH /messages/{messageId}
Редактирование. Доступно автору.
* Тело: `{ "ciphertext": "..." }`
* Ответ: `{ "messageId": "...", "editedAt": "...", "seq": ... }`

### DELETE /messages/{messageId}
Удаление. Доступно автору.
* Ответ: `{ "messageId": "...", "seq": ... }`

### POST /chats/{chatId}/read
Отметка о прочтении до указанного сообщения включительно.
* Тело: `{ "upToSeq": ... }` (или `{ "upToMessageId": "..." }`)
* Ответ: `{ "ok": true }`

## Поток событий (SSE)

### GET /events
Единый поток событий аккаунта. Один поток на устройство.

`event` — общий класс, а не только сообщения. Сообщения чата — лишь одна из категорий; в тот же поток идут события уровня аккаунта/безопасности (вход с другого устройства, добавление устройства). Поэтому `chatId` присутствует только у chat-scoped событий, а `seq` — сквозной на уровне аккаунта.

* Заголовок `Accept: text/event-stream`.
* При reconnect клиент шлёт `Last-Event-ID: <seq>` — сервер реплеит пропущенные события начиная с этого `seq`.
* Альтернатива для дельта-синка после пуша/долгого офлайна: `GET /events?since=<seq>` (одноразовый ответ списком, не стрим) — описать при реализации.

Конверт события (`event:` = тип, `data:` = JSON, `id:` = `seq`):

```
{
  "type": "message.new",
  "seq": 12345,
  "chatId": "...",          // только у chat-scoped событий, иначе отсутствует
  "ts": "2026-06-24T20:00:00Z",
  "payload": { ... }        // зависит от type
}
```

Chat-scoped события (несут `chatId`):

* `message.new` — `payload: { messageId, senderId, clientMessageId, ciphertext, ts }`
* `message.edited` — `payload: { messageId, ciphertext, editedAt }`
* `message.deleted` — `payload: { messageId }`
* `message.read` — `payload: { userId, upToSeq }`
* `typing` — `payload: { userId }` (эфемерное, без записи в лог)
* `chat.created` — `payload: { ... }`

Account/security-scoped события (без `chatId`):

* `auth.attempt` — попытка входа с другого устройства — `payload: { deviceId, ip, userAgent, ts }`
* `device.added` — к аккаунту добавлено устройство — `payload: { deviceId, ts }`
* `device.removed` — `payload: { deviceId }`

## Push-подписки

### POST /push/subscriptions
Регистрация канала пуша устройства (FCM-токен или UnifiedPush-endpoint). Пуш — это wake-up без содержимого сообщения.
* Тело: `{ "deviceId": "...", "provider": "fcm" | "unifiedpush", "endpoint": "..." }`
* Ответ: `{ "subscriptionId": "..." }`

### DELETE /push/subscriptions/{subscriptionId}
* Ответ: `{ "ok": true }`
