# 33. Превью ссылок (unfurl)

Полная реализация #66 — карточки-превью для URL в сообщениях.

**Сервер** (`src/server/src/unfurl.ts`):
- `POST /api/unfurl {url}` → `{ preview: { url, title, description, siteName, image } }`
- SSRF-защита: только http/https, блок приватных IP, проверка на каждом редиректе, таймауты, лимиты размера
- Парсинг OpenGraph/`<title>`/`<meta description>`
- Скачивание OG-картинки (base64) для inline-миниатюры

**Клиент**:
- Живой предпросмотр в композере (debounce → `unfurl()` → карточка)
- Крестик для снятия превью (запоминает снятый URL)
- Отправка: `kind:'link'` вложение в ciphertext
- Рендер: карточка с thumbnail, siteName, title, description

**Тесты**: `e2e/link-preview.spec.ts` — 2 сценария (отправка + крестик)
