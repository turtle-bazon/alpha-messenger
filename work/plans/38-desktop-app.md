# План реализации #38 — Десктопное приложение

## Архитектурное решение

**Electron** — более зрелый фреймворк, проще интеграция с существующим Node.js стеком. Tauri легче по бинарнику, но требует Rust и системного webview.

## Структура проекта

```
src/desktop_client/
├── package.json
├── electron-builder.yml
├── src/
│   ├── main/                    # Main process
│   │   ├── index.ts             # Точка входа
│   │   ├── tray.ts              # Иконка в трее
│   │   ├── notifications.ts     # Нативные уведомления
│   │   ├── hotkeys.ts           # Горячие клавиши
│   │   ├── autostart.ts         # Автозапуск
│   │   ├── updater.ts           # Проверка обновлений
│   │   └── preload.ts           # Безопасный IPC bridge
│   └── renderer/                # Ссылка на web_client
│       └── index.html           # Entry point для Vite
├── resources/                   # Иконки, ресурсы
│   ├── icon.ico                 # Windows
│   ├── icon.icns                # macOS
│   └── icon.png                 # Linux
└── build/                       # Скрипты сборки
```

## Этапы реализации

### Этап 1: MVP — Электрон + Трей (2-3 дня) ✅ ЧАСТИЧНО
1. **Инициализация проекта** ✅
   - `npm init` в `src/desktop_client` ✅
   - Установка `electron`, `electron-builder` ✅
   - Настройка TypeScript ✅

2. **Main process** ✅
   - Базовый BrowserWindow, загружающий Vite dev server или built SPA ✅
   - Preload script с безопасным IPC ✅
   - Dev mode: подключение к `localhost:5173` ✅
   - Prod mode: загрузка built `dist/` ✅

3. **Трей** ✅
   - Иконка в системном трее (platform-specific) ✅
   - Клик по трею → показ/скрытие окна ✅
   - Контекстное меню (Показать, Выход) ✅
   - Сворачивание в трей вместо закрытия ✅

**Статус:** Структура создана, нужен `npm install` и тестовый запуск

### Этап 2: Нативные уведомления (1 день)
4. **Интеграция с нативными уведомлениями**
   - Electron `Notification` API вместо Web Notifications
   - IPC: renderer → main → показ уведомления
   - Клик по уведомлению → фокус окна
   - Обработка `click`, `close`, `action` событий

### Этап 3: Горячие клавиши (0.5 дня)
5. **Глобальные шорткаты**
   - `globalShortcut.register('CommandOrControl+K', ...)` → фокус на поиск
   - `globalShortcut.register('CommandOrControl+N', ...)` → новый чат
   - Cleanup при unmount

### Этап 4: Автозапуск (0.5 дня)
6. **Автозапуск при старте**
   - `app.setLoginItemSettings({ openAtLogin: true })`
   - Настройка в UI (тоггл в настройках)
   - Платформенная интеграция (Launch Agent на macOS, Registry на Windows)

### Этап 5: Проверка обновлений (1 день)
7. **Auto-updater**
   - `electron-updater` + GitHub Releases
   - Проверка обновлений при запуске
   - Уведомление о доступном обновлении
   - Автоматическая установка + рестарт

### Этап 6: Оффлайн + Сборка (1-2 дня) ✅ ЧАСТИЧНО
8. **Оффлайн-кэширование**
   - Service Worker для кэширования статики
   - IndexedDB для сообщений (опционально)
   - Offline-first архитектура

9. **Сборка и дистрибуция** ✅
   - `electron-builder` конфигурация ✅
   - Platform builds: `.exe` (Windows), `.dmg` (macOS), `.AppImage` (Linux) ✅
   - **CI/CD: GitHub Actions** — автоматическая сборка бинарников для всех платформ ✅
   - Code signing (опционально)

## Интеграция с текущим кодом

**Изменения в `src/web_client`:**
- Добавить IPC bridge для нативных уведомлений
- Экспортировать функции для IPC (показ уведомления, фокус окна)
- Detect Electron环境 (`window.electronAPI`)

**Обратная совместимость:**
- Web версия продолжает работать без изменений
- Desktop-specific код в отдельных модулях
- Условные проверки: `if (window.electronAPI) { ... }`

## Сроки

| Этап | Дни | Описание |
|------|-----|----------|
| MVP + Трей | 2-3 | Базовый Electron + трей (Win/Mac/Linux) |
| Уведомления | 1 | Нативные уведомления |
| Хардкорды | 0.5 | Ctrl+K, Ctrl+N |
| Автозапуск | 0.5 | Login item |
| Обновления | 1 | Auto-updater |
| Сборка + CI | 1-2 | GitHub Actions для всех платформ |
| **Итого** | **6-8** | Полная реализация |

## Технические риски

1. **Electron безопасность**: Proper contextIsolation, nodeIntegration: false
2. **Платформенные различия**: Трей работает по-разному на Win/Mac/Linux
3. **Размер бинарника**: ~150-200MB (нормально для Electron)
4. **Обновления**: Требуют GitHub Releases или свой сервер

## Рекомендации

1. Начать с MVP (только трей + уведомления)
2. Использовать `electron-vite` для интеграции с Vite
3. Тестировать на всех платформах early
4. Code signing для macOS (иначе Gatekeeper блокирует)

## Вопросы перед стартом

1. ~~Какой фреймворк предпочтительнее — Electron или Tauri?~~ → **Electron**
2. ~~Нужна ли поддержка Linux в первом релизе?~~ → **Да, обязательно**
3. Как распространять обновления — GitHub Releases или свой сервер?
4. Нужен ли code signing для macOS?

## Будущее (посмотреть позже)

- **Deno** — альтернатива Node.js для сервера. Нативный TypeScript, единый бинарник, встроенный WebSocket. Потенциальная замена Node.js в сервере, если появятся конкретные преимущества. Не для десктопа (нет GUI API).
