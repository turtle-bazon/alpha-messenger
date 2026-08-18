-- Публичные каналы: username для поиска, роли участников, view-count.

-- Публичный username канала (уникальный, nullable).
ALTER TABLE chats ADD COLUMN username text;
ALTER TABLE chats ADD CONSTRAINT chats_username_unique UNIQUE (username);

-- Роль участника: owner, admin, member (группы) / subscriber (каналы).
ALTER TABLE chat_members ADD COLUMN role text NOT NULL DEFAULT 'member'
  CHECK (role IN ('owner', 'admin', 'member', 'subscriber'));

-- Назначаем owner'ов существующих групп/каналов.
UPDATE chat_members SET role = 'owner'
WHERE user_id = (SELECT created_by FROM chats WHERE chat_id = chat_members.chat_id);

-- Счётчик просмотров на сообщениях.
ALTER TABLE messages ADD COLUMN view_count int NOT NULL DEFAULT 0;

-- Индекс для поиска каналов по username/title.
CREATE INDEX idx_chats_username ON chats(username) WHERE username IS NOT NULL;
