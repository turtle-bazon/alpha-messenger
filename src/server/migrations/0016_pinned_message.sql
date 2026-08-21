-- Pinned message per chat (#86). One pinned message per chat, like Telegram.
ALTER TABLE chats ADD COLUMN pinned_message_id BIGINT REFERENCES messages(message_id) ON DELETE SET NULL;
