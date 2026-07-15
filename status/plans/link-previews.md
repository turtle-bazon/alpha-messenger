# План: превью ссылок (#66)

Статус: СДЕЛАНО (шаги 1–9). Сервер: тесты unfurl 6/6, весь набор 20/20. Клиент:
сборка чистая, регресс e2e 35/35 (вкл. 2 новых сценария превью). Реальный фетч в
запущенном dev-сервере заработает после пересборки образа (`run/dev` up --build).

## Сервер
1. `POST /api/unfurl { url }` → `{ url, title, description, siteName, image? }`.
   * SSRF-guard: схема http/https; резолв хоста, отказ на приватные/loopback/
     link-local/ULA; ручной обход редиректов с перепроверкой каждого хопа; лимит
     редиректов; таймаут; потолок размера; только `text/html`.
   * Парс OG/`<title>`/`meta description` без тяжёлых зависимостей (regex по
     `<meta property|name=... content=...>` + `<title>`).
   * `image`: скачать og:image (тот же SSRF-guard + лимит), вернуть
     `{ mime, dataBase64 }`. Картинку режет клиент.
   * Флаг `UNFURL_ALLOW_PRIVATE` (dev/тест) — разрешить localhost.
2. Тест `test/unfurl.test.ts`: OG-страница → метаданные; приватный адрес → отказ;
   не-html → пусто/мягкая ошибка; битый URL → 400.

## Клиент
3. Модель: `LinkAttachment` в union `Attachment` (util/content.ts); encode/decode
   `k:'link'`; previewText без изменений (текст содержит URL).
4. API: `unfurl(url)` в api/rest.ts.
5. Композер: детект первого URL в textarea (regex) + debounce; вызов `unfurl`;
   карточка-превью над полем; крестик снимает (запоминаем снятый URL). На отправке
   готовый `LinkAttachment` уезжает в `attachments` (без блоба — `thumb` inline).
6. Очередь отправки: пронести опц. `link` в элементе очереди; `pump()` кладёт его
   в `content.attachments` (доп. blobIds не нужны).
7. Рендер: `LinkPreviewCard` в пузыре (siteName/title/description/thumb), клик →
   открыть URL в новой вкладке. Стили в index.css.
8. Тест `e2e/link-preview.spec.ts`: фикстура-страница с OG-тегами (из public/,
   отдаётся vite на :5173), сервер с `UNFURL_ALLOW_PRIVATE=1`; набор URL →
   карточка в композере → отправка → доставка карточки собеседнику по WS; крестик
   снимает превью.

## Регресс
9. Сборка сервера и клиента, серверные тесты, регресс e2e клиента.
