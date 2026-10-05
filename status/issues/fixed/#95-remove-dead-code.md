# #95 — Удаление мёртвого кода (NotificationSettings, SearchChannelsDialog)

Найдено при разборе падения e2e: UI уведомлений переехал в экран настроек, а
старые компоненты остались в дереве без единого импорта.

## Что мертво

- `src/web_client/src/notifications/NotificationSettings.tsx` (178 строк) —
  ни одного импорта в проекте. Настройки уведомлений живут в
  `SettingsScreen.tsx`: `settings-sound`, `settings-browser`, `settings-denied`.
- `SearchChannelsDialog` (экспортируется из `chats/ChannelInfoDialog.tsx`) —
  нигде не рендерится, то есть в UI нет способа найти публичный канал по
  имени. Рабочий путь — ссылка `/channel/@handle/`.

## Что сделать

- Удалить оба компонента.
- Удалить CSS, который обслуживал только их: `.notif-menu`, `.notif-row`,
  `.notif-hint`, `.search-input` (проверить, что не используется больше нигде).
- Проверить, что ни один e2e-спека не ссылается на их `data-testid`
  (`notif-toggle`, `notif-menu`, `notif-sound`, `notif-browser`, `notif-denied`,
  `search-channels-dialog`).
## Приоритет

minor

## Реализация

Удалено:

- `src/web_client/src/notifications/NotificationSettings.tsx` — файл целиком.
- `SearchChannelsDialog` — экспорт и импорт в `chats/ChannelInfoDialog.tsx`
  (компонент нигде не рендерился).
- CSS: блок `/* Search channels dialog. */` целиком (`.search-channels-dialog`,
  `.search-input`, `.search-results`, `.search-result-item`,
  `.search-result-avatar`, `.search-result-info`, `.search-result-title`,
  `.search-result-subtitle`, `.search-result-meta`, `.search-loading`,
  `.search-empty`) и мёртвые правила меню уведомлений (`.notif-settings`,
  `.notif-menu`, `.notif-row`, `.notif-hint`).

Проверено перед удалением: ни один `data-testid` удалённых компонентов
(`notif-toggle`, `notif-menu`, `notif-sound`, `notif-browser`, `notif-denied`,
`search-channels-dialog`) не используется ни в `src`, ни в `e2e`. Класс
`.search-input` не переиспользуется: поиск чатов использует
`.chat-search-input` (`chats/ChatList.tsx`).

Побочно, в рамках той же задачи, устранена нестабильность e2e
(`e2e/session-expiry.spec.ts`): тест «потеря сессии разлогинивает» висел
30 с. Причина была не в приложении: после удаления сессии клиент верно
остаётся в состоянии «зомби» (токен в localStorage, запросов нет, WS жив), а
тест инициировал 401 кликом по кнопке создания чата — клик конкурировал с
перезагрузкой приложения и съедал весь таймаут теста, из-за чего ассерт
экрана входа не успевал провериться. Теперь каждый шаг триггера ограничен по
времени (4 с), ошибки кликов глушатся, и проверка экрана входа получает весь
бюджет. Настройки e2e: `expect.timeout` 10 с (`playwright.config.ts`),
превью чата в `login-replay.spec.ts` опрашивается до появления.

Проверка: `tsc --noEmit` чистый, серверные тесты 24/24, полный e2e 79/79
три раза подряд на чистой схеме БД.
