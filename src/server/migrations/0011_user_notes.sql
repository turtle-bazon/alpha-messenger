-- Личные заметки о других пользователях.
-- Видны только автору. Привязаны к паре (author, target).

CREATE TABLE user_notes (
  author_id    uuid NOT NULL REFERENCES accounts(user_id) ON DELETE CASCADE,
  target_id    uuid NOT NULL REFERENCES accounts(user_id) ON DELETE CASCADE,
  note         text NOT NULL DEFAULT '',
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (author_id, target_id)
);
CREATE INDEX idx_user_notes_target ON user_notes(target_id);
