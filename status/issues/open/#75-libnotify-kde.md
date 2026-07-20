# #75 — Уведомления через libnotify в Linux (KDE)

## Описание
На десктопном клиенте (Electron) в Linux уведомления не попадают в центр уведомлений KDE (История уведомлений). Нужно использовать libnotify (D-Bus) для нативных уведомлений, которые будут видны в KDE/KWin.

## Проблема
- Текущая реализация: `Notification` API в браузере / Electron
- В KDE Plasma уведомления через Electron не всегда попадают в "Историю уведомлений"
- Нужно чтобы уведомления отображались в KDE-центре уведомлений (как в Telegram Desktop)

## Решение
- Использовать `@aspect-build/electron-notification-linux` или нативный D-Bus через Electron main process
- Или: `node-notifier` с бэкендом `libnotify` (notify-osd / dunst / KDE Plasma)
- Уведомления должны: показываться в центре уведомлений KDE, сохраняться в истории, поддерживать click action

## Контекст
- Electron main process уже показывает уведомления через `new Notification()` (см. `preload.ts`)
- В GNOME уведомления работают корректно, проблема именно в KDE Plasma
- Telegram Desktop использует libnotify — уведомления видны в KDE
