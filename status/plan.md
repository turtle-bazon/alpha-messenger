1. Зафиксировать в doc ключевые решения: транспорт (SSE+REST), общий поток событий, push как отдельный канал, PostgreSQL, отказ от кэша сообщений на клиенте в v1 — СДЕЛАНО (doc/architecture.md, doc/api.md).
2. Поднять каркас сервера на TypeScript в src/server и собрать docker-compose в run (сервис + PostgreSQL).
3. Завести схему БД: accounts, devices, chats, chat_members, messages (ciphertext-blob + метаданные), push_subscriptions, events (outbox с монотонным seq).
4. Реализовать аутентификацию и устройства: открытая саморегистрация username+password (argon2id-хэш), POST /auth/register (с авто-логином), POST /auth/login (сессия на пару аккаунт+устройство, авто-регистрация незнакомого устройства с эмитом device.added/auth.attempt), POST /devices, GET /me.
5. Реализовать чаты: GET /chats (с lastMessage), POST /chats, GET /chats/{chatId}.
6. Реализовать сообщения: GET /chats/{chatId}/messages (пагинация по seq), POST /chats/{chatId}/messages (идемпотентность по clientMessageId), PATCH /messages/{id}, DELETE /messages/{id}, POST /chats/{chatId}/read.
7. Реализовать SSE-поток GET /events: fan-out из outbox, поддержка Last-Event-ID и replay по seq.
8. Реализовать дельта-синк GET /events?since=seq для досинхронизации после офлайна/пуша.
9. Реализовать push-подписки: POST/DELETE /push/subscriptions; заглушка отправки wake-up (FCM/UnifiedPush) без содержимого сообщения.
10. Написать минимальные функциональные тесты на каждый endpoint.
