# 35. WYSIWYG-композер с панелью форматирования

Полная реализация #69 — WYSIWYG-композер и панель форматирования.

**Компоненты:**
- `WysiwygComposer.tsx` — два слоя: скрытый textarea (raw markdown) + overlay div (рендеренный markdown)
- `FormattingToolbar.tsx` — панель кнопок (Bold, Italic, Strike, Code, Link)
- `LinkDialog.tsx` — диалог ввода URL для ссылок

**Поведение:**
- Композер отображает отформатированный текст в реальном времени
- `**жирный**` → отображается как **жирный**
- Панель форматирования появляется только при выделении текста
- Кнопки оборачивают выделение в markdown-разметку
- Горячие клавиши: Ctrl+B (bold), Ctrl+I (italic), Ctrl+K (link)
- Диалог ввода ссылки с полями "Текст" и "URL"

**CSS:** `.composer-wrapper`, `.composer-rendered`, `.composer-raw`, `.formatting-bar`, `.formatting-btn`, `.link-dialog`

**Тесты:** 4 новых сценария (WYSIWYG рендер, панель при выделении, клик Bold, Ctrl+B)
