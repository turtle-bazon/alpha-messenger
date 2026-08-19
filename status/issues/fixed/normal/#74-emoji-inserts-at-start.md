# #74 — Emoji вставляется в начало, а не в позицию курсора

## Проблема
При выборе смайлика из пикера он вставляется в самое начало текста вместо текущей позиции курсора.

## Диагноз

### Баг 1: Фокус теряется при открытии пикера
- **Файл:** `src/web_client/src/chats/Conversation.tsx` (строка ~1782)
- Кнопка 😊 использует `onClick`, а не `onMouseDown` + `e.preventDefault()`.
- При клике браузер ставит фокус на кнопку → contentEditable blur → `window.getSelection()` инвалидируется.
- **Фикс:** Заменить `onClick` на `onMouseDown` с `e.preventDefault()` (как в FormattingToolbar) ИЛИ сохранять Selection перед открытием пикера.

### Баг 2: Курсор не восстанавливается перед вставкой
- **Файл:** `src/web_client/src/chats/Conversation.tsx` (строки ~1810–1817)
- `onSelectEmoji` делает `el.focus()` → `document.execCommand('insertText')`.
- `el.focus()` возвращает DOM-фокус, но **не** восстанавливает `window.getSelection()` — браузер ставит каретку в позицию 0.
- **Фикс:** Перед `execCommand` восстановить сохранённый Range: `sel.removeAllRanges(); sel.addRange(savedRange)`.

### Сравнение с рабочими путями
- **FormattingToolbar** (кнопки bold/italic): используют `onMouseDown` + `e.preventDefault()` → фокус не теряется → `execCommand` работает от текущей позиции.
- **Mention insertion** (строки 684–706): сохраняет `window.getSelection()` → конструирует Range → `addRange()` → `execCommand` — курсор на месте.

## Решение
1. Сохранять `window.getSelection().getRangeAt(0).cloneRange()` при фокусе на contentEditable (или при открытии пикера).
2. Перед `execCommand('insertText')` восстанавливать сохранённый Range.
3. Эмодзи-кнопка в пикере — `onMouseDown` + `e.preventDefault()` чтобы не.blurить contentEditable.

## Acceptance criteria
- [ ] Смайлик вставляется ровно в позицию курсора, а не в начало
- [ ] Курсор остаётся на месте после вставки (можно продолжать печатать)
- [ ] Регресс: форматирование (bold/italic) по-прежнему работает от позиции курсора
- [ ] Регресс: mention-вставка по-прежнему работает
