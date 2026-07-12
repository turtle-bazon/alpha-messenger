# #51 — Подсветка сообщения при переходе к нему

При переходе на сообщение (клик по reply preview) — сообщение подсвечивается синей полоской слева, которая плавно исчезает.

## Статус: исправлено ✅

## Реализация
- `MsgVM.highlighted: boolean`
- Клик по reply preview → `highlighted = true` + scroll, через 2 сек → `false`
- CSS: `border-left: 3px solid rgba(51,144,236,0.7)` с анимацией в `transparent`
