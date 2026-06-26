# 4. Регистрация по инвайтам и аутентификация

Реализована регистрация по инвайт-кодам (migrations/0002_invites.sql, скрипт npm run invite, порт Postgres опубликован на 127.0.0.1 для генерации с хоста) и аутентификация: POST /auth/register, /auth/login (argon2id, сессии на пару аккаунт+устройство, авто-регистрация устройства с событиями device.added/auth.attempt в outbox), POST /devices, GET /me. Покрыто функциональным тестом test/auth.test.ts; проверено на реальном контейнере.
