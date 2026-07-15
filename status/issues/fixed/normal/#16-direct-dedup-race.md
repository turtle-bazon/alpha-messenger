# #16 — Гонка дедупликации direct-чата

Дедупликация direct-чата не защищена от гонки: два одновременных POST /chats (direct) с теми же участниками могут создать два чата. Для v1 приемлемо. Решение при необходимости — уникальный ключ по канонической паре участников (least/greatest user_id) или advisory-lock на пару.

## Решение
Advisory lock через `pg_advisory_xact_lock(lockKey)` внутри транзакции. lockKey — int32 хеш от канонической пары participant IDs (LEAST, GREATEST). Проверка дедупликации перенесена внутрь транзакции после acquire lock.

Файл: `src/server/src/routes/chats.ts`, функция `createDirect`
