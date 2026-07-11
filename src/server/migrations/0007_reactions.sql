-- Message reactions (#23): эмодзи-реакции на сообщения.
-- Каждый пользователь может поставить одну реакцию на сообщение.
-- Уникальный constraint: (message_id, user_id) — одна реакция на юзера.

CREATE TABLE message_reactions (
  message_id   bigint NOT NULL REFERENCES messages(message_id) ON DELETE CASCADE,
  user_id      uuid  NOT NULL REFERENCES accounts(user_id) ON DELETE CASCADE,
  emoji        text  NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (message_id, user_id)
);

CREATE INDEX idx_reactions_message ON message_reactions(message_id);
