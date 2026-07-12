CREATE TABLE IF NOT EXISTS drafts (
  chat_id   TEXT NOT NULL REFERENCES chats(chat_id) ON DELETE CASCADE,
  user_id   TEXT NOT NULL REFERENCES accounts(user_id) ON DELETE CASCADE,
  ciphertext TEXT NOT NULL DEFAULT '',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (chat_id, user_id)
);
