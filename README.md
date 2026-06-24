# alpha_messenger

E2E-мессенджер с собственным протоколом поверх HTTP (REST — действия, WebSocket — события). Сервер видит только зашифрованный blob.

Нужно: **Docker** (с compose). Node 20+ — только для режима разработки и тестов.

## Запуск (prod) — всё в Docker

```bash
cd run/prod
docker compose up -d --build
```

Поднимет БД, сервер (http://localhost:3000) и веб-клиент (http://localhost:5173). Миграции применяются автоматически.

## Создание invite-линк

Регистрация — только по одноразовому коду. С поднятым стеком, прямо из каталога окружения:

```bash
./invite.sh
```

Выведет ссылку `http://localhost:5173/register?invite=<КОД>` — откройте её в браузере. Чтобы проверить переписку вживую, создайте второй invite и войдите вторым пользователем в другом окне/профиле браузера. (Код кладётся в БД через работающий контейнер — Node не нужен.)

## Разработка (dev)

БД и сервер — в Docker, клиент — через Vite (с горячей перезагрузкой):

```bash
cd run/dev
docker compose up -d --build          # БД + сервер
cd ../../src/web_client
npm ci && npm run dev                 # клиент на http://localhost:5173
```

Invite — `./invite.sh` из `run/dev`.

## Тесты

С поднятым dev-стеком (БД + сервер):

```bash
# Тесты сервера (каждый endpoint)
cd src/server && npm test

# Сквозные UI-тесты (Playwright; первый раз — поставить браузер)
cd src/web_client
npx playwright install chromium
npm run test:e2e
```
