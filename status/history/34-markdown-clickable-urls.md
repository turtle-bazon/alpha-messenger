# 34. Markdown в сообщениях и кликабельные ссылки

Полная реализация #68 — поддержка форматирования текста и кликабельных URL.

**Парсер** (`src/web_client/src/util/mentions.tsx`):
- `renderMessageText(text, usernames)` — заменяет `renderMentionText()`
- Токенизация: code → bold → italic → strike → links → urls → mentions
- Code-spans защищены от парсинга внутри
- XSS-безопасность через React elements

**Поддерживаемый синтаксис**:
- `**жирный**` → `<strong>`
- `_курсив_` → `<em>`
- `` `код` `` → `<code>` (моноширинный фон)
- `~~зачёркнутый~~` → `<del>`
- `[текст](url)` → кликабельная ссылка
- Автодетект URL → кликабельная ссылка
- @mentions → подсветка

**CSS**: `.message-link` (accent-цвет), `.message-code` (фон, моноширинный)

**Тесты**: `e2e/markdown.spec.ts` — 4 сценария (bold/italic/code/strike, URL, markdown-ссылка, код не парсится)
