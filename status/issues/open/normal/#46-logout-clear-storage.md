# #46 — Очистка localStorage при логауте

## Описание
При выходе из аккаунта нужно очищать localStorage, но сохранять настройки уведомлений (`alpha.notif.sound`, `alpha.notif.browser`).

## Что очищать
- `alpha.serverUrl` (десктоп) — чтобы вернуться на setup screen
- `alpha.token` / `alpha.userId` / `alpha.lastSeq` — сессия
- Любые другие ключи приложения

## Что сохранять
- `alpha.notif.sound` — звук уведомлений
- `alpha.notif.browser` — браузерные уведомления

## Реализация
- В функции logout (или `session.clear()`) — перечислить ключи для удаления или удалить всё кроме `alpha.notif.*`
- На desktop также вызвать `showSetup()` для возврата на экран настройки

## Приоритет
Normal

## Статус
Открыта
