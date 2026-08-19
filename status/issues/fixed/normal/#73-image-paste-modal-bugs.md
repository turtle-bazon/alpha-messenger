# #73 — Image paste/upload modal bugs

## Проблема
При вставке изображения (paste) модалка ImageEditor ломается:
1. Кнопка «Отправить» вылезает за пределы модалки на узких экранах
2. При наборе подписи фокус «уходит» из поля ввода — печатать невозможно

## Диагноз

### Баг 1: Кнопка вылезает за модалку
- **Файл:** `src/web_client/src/index.css` (строки ~1293–1319)
- **Причина:** `.img-editor-controls` — `display: flex` без `flex-wrap`. На телефоне (360px) модалка = 331px, три кнопки (~279px) + инпут не влезают. Кнопка «Отправить» визуально выходит за `border-radius`.
- **Фикс:** Добавить `flex-wrap: wrap` в `.img-editor-controls`.

### Баг 2: Фокус теряется при каждом ререндере Conversation
- **Файл:** `src/web_client/src/chats/ImageEditor.tsx` (строки 37–39)
- **Причина:** `useEffect` с cleanup зависит от пропса `onClose`:
  ```tsx
  useEffect(() => {
    return () => { onClose?.(); };
  }, [onClose]);
  ```
  В `Conversation.tsx:1870` `onClose` — это inline-стрелочная функция `() => inputRef.current?.focus()`. Каждый ререндер Conversation (сообщения, typing, read-маркеры и т.д.) создаёт **новую** функцию → useEffect запускает cleanup → вызывает `onClose()` → **крадёт фокус** из caption-input обратно в composer.
- **Фикс:** Внутри ImageEditor хранить `onClose` через `useRef` (актуальная ссылка), cleanup-эффект с пустым массивом зависимостей:
  ```tsx
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    return () => { onCloseRef.current?.(); };
  }, []); // unmount only
  ```

## Acceptance criteria
- [ ] На экране ≤360px кнопки модалки не выходят за границы карточки
- [ ] При открытии модалки фокус на caption-input и НЕ теряется при печати
- [ ] Регресс: закрытие модалки по Escape / клику вне по-прежнему работает
- [ ] Регресс: отправка изображения с подписью работает
