# 3. Первичная схема БД

Заведена первичная схема БД (migrations/0001_init.sql): accounts, devices, sessions, chats, chat_members, messages, push_subscriptions, events (outbox). Идентичность сущностей — uuid; порядок сообщений (message_id) и курсор потока событий (seq) — глобальные IDENTITY-последовательности. Проверено: миграция применяется, все таблицы создаются.
