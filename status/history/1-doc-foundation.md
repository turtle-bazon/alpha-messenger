# 1. Первичная документация продукта

Заложена первичная документация продукта в doc: architecture.md (транспорт WebSocket+REST — действия по REST, поток событий по WS с resume через hello/lastSeq; общий канал событий, push как отдельный канал FCM/UnifiedPush, PostgreSQL, стек Fastify+@fastify/websocket+pg, упрощённая регистрация username+password только по инвайт-коду (без ролей; коды генерит скрипт npm run invite), отказ от кэша сообщений на клиенте в v1), api.md (черновик контракта REST + WS), ui.md (ориентир на десктопный Telegram, центрирование с max-width).
