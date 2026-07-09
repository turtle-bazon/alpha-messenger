-- Reply to message: колонка reply_to_message_id в messages (#33).
-- Nullable FK: при отсутствии ответа — NULL.

ALTER TABLE messages
  ADD COLUMN reply_to_message_id bigint REFERENCES messages(message_id)
    ON DELETE SET NULL;
