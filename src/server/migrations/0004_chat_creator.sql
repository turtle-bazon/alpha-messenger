-- Создатель чата. Нужен для прав управления участниками (удаление из группы).
-- Для чатов, созданных до миграции, остаётся NULL — у них управляющего нет.
-- ON DELETE SET NULL: удаление аккаунта не должно ронять чат (история остаётся).
ALTER TABLE chats
  ADD COLUMN created_by uuid REFERENCES accounts(user_id) ON DELETE SET NULL;
