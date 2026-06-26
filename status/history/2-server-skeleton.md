# 2. Каркас сервера и docker-compose

Поднят каркас сервера на TypeScript (Fastify + node-postgres) в src/server с раннером миграций и эндпоинтом /health; собран run/docker-compose.yaml (сервис + PostgreSQL). Проверено: стек поднимается, /health отдаёт ok с обращением к БД.
