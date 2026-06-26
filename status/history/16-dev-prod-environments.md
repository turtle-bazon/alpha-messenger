# 16. Окружения dev и prod

Сборка/запуск разнесены на два окружения в run/: prod (всё в Docker — БД, сервер и веб-клиент статикой через nginx с SPA-fallback на 5173; конечное решение, host-Node не нужен) и dev (БД+сервер в Docker, клиент через Vite/HMR). Добавлены src/web_client/Dockerfile (vite build → nginx) и nginx.conf; invite.sh положен в каждый каталог окружения (кладёт код в БД через контейнер). README переписан под dev/prod. Prod-стек проверен: nginx отдаёт /register, клиент грузится в реальном браузере без ошибок, регистрация по invite — 201.
