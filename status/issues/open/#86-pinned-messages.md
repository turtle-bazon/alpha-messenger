# #86 — Закреплённые сообщения

Закрепление одного сообщения в чате с плашкой сверху (как в Telegram).

## Сервер
- Миграция `0016_pinned_message.sql`: `chats.pinned_message_id` (FK на messages,
  ON DELETE SET NULL).
- `PUT /chats/:chatId/pin { messageId }` / `DELETE /chats/:chatId/pin` — только
  участнику, сообщение должно принадлежать чату. Возвращают обновлённый ChatView.
- Событие outbox `chat.pinned` всем участникам (pinnedMessageId, byUserId).
- `pinnedMessageId` включён в loadChat/ChatView.

## Клиент
- REST: pinMessage/unpinMessage; тип Chat.pinnedMessageId.
- WS-обработчик chat.pinned в HomeScreen обновляет список чатов.
- Conversation: плашка под шапкой (имя + превью через previewText), клик —
  прыжок к сообщению (если загружено), крестик — открепить. Превью берётся из
  загруженной истории либо точечным фетчем (before = id+1, limit 1).
- Контекстное меню сообщения: «Закрепить»/«Открепить».

## Приоритет
normal
