# #38 — Десктопное приложение

Вынести веб-клиент в отдельное десктопное приложение (Electron) с иконкой в трее, нативными уведомлениями и автозапуском.

## Требования
- Иконка в трее (сворачивание вместо закрытия) ✅
- Нативные уведомления ОС ✅
- Автозапуск при старте системы (опционально) — не реализовано, отдельной задачей не является
- Горячие клавиши (Ctrl+K — поиск, Ctrl+N — новый чат) ✅ (в web-клиенте)
- Проверка обновлений — отдельная задача #43
- Работа оффлайн (кэширование) — web-клиент загружается с сервера или bundled
- Платформы: Windows, macOS, **Linux (обязательно)** ✅
- Сборка бинарников через GitHub Actions ✅

## Технологии
- **Electron** (выбрано)
- Интеграция с существующим Vite-клиентом

## Реализация ✅

### Структура
- `src/desktop_client/` — Electron-проект
- `package.json` с зависимостями (electron, electron-builder)
- `tsconfig.json` для main process
- `electron-builder.yml`: конфигурация для Win/Mac/Linux

### Main process
- `src/main/index.ts`: BrowserWindow, setup screen, IPC handlers (load-web-client, show-setup, window management, badge count, version, platform)
- `src/main/preload.ts`: безопасный IPC bridge (electronAPI)
- `src/main/tray.ts`: контекстное меню, двойной клик, badge через tooltip
- `src/main/notifications.ts`: Electron Notification API, клик по уведомлению

### Иконки
- `resources/icon.png` — 512×512, прозрачный фон + синий α
- `resources/trayIcon.png` — 32×32, прозрачный фон + синий α

### CI/CD
- `.github/workflows/desktop-build.yml`: сборка Win/Mac/Linux через GitHub Actions

### Особенности
- Загрузка web-клиента с сервера (приоритет) → fallback на bundled версию
- `web_client_dist/` — bundled web-клиент в составе desktop-пакета
- Сворачивание в трей вместо закрытия
- Badge на иконке (непрочитанные) через `app.setBadgeCount` + title fallback

## Остались отдельные задачи
- `#48` Клик по иконке не открывает окно (single instance lock)
- `#43` Автообновления (minor)
- Автозапуск при старте системы (опционально, низкий приоритет)
