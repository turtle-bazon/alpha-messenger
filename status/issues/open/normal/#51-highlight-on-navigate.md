# #51 — Подсветка сообщения при переходе к нему

При переходе на сообщение (клик по reply preview, навигация по @) — сообщение должно подсветиться другим цветом и плавно вернуться к обычному виду.

## Поведение
- Клик по reply preview в пузыре → скролл к оригинальному сообщению
- Сообщение получает класс-подсветку (например `is-highlighted`)
- CSS-анимация: плавное изменение фона за ~1.5–2 секунды
- После завершения анимации — класс снимается

## CSS
```css
.bubble.is-highlighted {
  animation: highlight-fade 2s ease-out;
}

@keyframes highlight-fade {
  0% { background: rgba(51, 144, 236, 0.2); }
  100% { background: transparent; }
}
```

## Реализация
- В `MsgVM` добавить флаг `highlighted: boolean`
- При переходе к сообщению — ставить `highlighted = true`
- Через `setTimeout` (2 сек) — снимать флаг
- Класс `is-highlighted` вешается на `.bubble`

## Приоритет
normal
