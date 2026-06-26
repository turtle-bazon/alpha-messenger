# #2 — Относительные URL клиента за обратным прокси

Клиент за обратным прокси больше не ходит в localhost:3000. В прод-сборке VITE_API_URL='' → URL относительные (запросы на тот же origin, что и страница; CORS не возникает, образ не привязан к домену). wsUrl() при пустом API_URL строится из window.location (схема ws/wss по протоколу страницы). Build-arg VITE_API_URL добавлен в client Dockerfile (дефолт localhost:3000 для локальной run/prod-сборки) и проброшен пустым в CI (.github/workflows/docker-image.yml) для публикуемого образа.
