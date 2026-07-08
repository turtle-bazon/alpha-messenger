# #40 — Расширенный фокус в поле ввода

Всегда возвращать фокус в поле ввода消息 после клика по пустому месту в списке чатов или в области сообщений.

## Поведение
- Клик в пустое место в ChatList → фокус на input
- Клик в область сообщений (не на сообщение) → фокус на input
- Клик на сообщение → фокус НЕ возвращается (может быть выделение текста)
- Нажатие клавиши → фокус на input
- Вставка изображения (Ctrl+V) → фокус на input

## Реализация
- `onClick` на контейнерах с `stopPropagation` на интерактивных элементах
- Глобальный `keydown` listener → `inputRef.current?.focus()`
- `paste` listener → `inputRef.current?.focus()`
- `useRef` для input, передаваемый в ChatList и Conversation

## Реализация (выполнено)

### Изменения в коде
1. **`src/web_client/src/HomeScreen.tsx`**:
   - Создан `inputRef` в HomeScreen (строка 83)
   - Передаётся в `Conversation` как пропс (строка 501)
   - Передаётся в `ChatList` как `onFocusInput` callback (строка 491)
   - Добавлен глобальный `useEffect` с `keydown` и `paste` listeners (строки 107-123)
   - `keydown` игнорирует модификаторы (Ctrl/Alt/Meta) и служебные клавиши

2. **`src/web_client/src/chats/ChatList.tsx`**:
   - Добавлен проп `onFocusInput: () => void` (строка 35)
   - Добавлен `onClick` на `<aside>` с проверкой `tag !== 'BUTTON' && tag !== 'INPUT'` (строки 68-72)

3. **`src/web_client/src/chats/Conversation.tsx`**:
   - `inputRef` теперь передаётся как пропс вместо создания локально (строка 146)
   - Добавлен `onClick` на `div.conv-scroll` с проверкой `!target.closest('.bubble')` (строки 764-776)

### Логика фокуса
- **Клик в ChatList**: фокус если тег не BUTTON и не INPUT
- **Клик в Conversation**: фокус если нет `.bubble`, `button`, `input` или `textarea` в цепочке родителей
- **Клавиатура**: глобальный listener, игнорирует модификаторы и служебные клавиши
- **Вставка**: глобальный paste listener → focus
