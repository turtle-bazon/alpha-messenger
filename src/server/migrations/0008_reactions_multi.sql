-- Исправление PK для реакций: разрешить несколько реакций от одного юзера (#23).
-- Старый PK был (message_id, user_id), новый — (message_id, user_id, emoji).

ALTER TABLE message_reactions DROP CONSTRAINT message_reactions_pkey;
ALTER TABLE message_reactions ADD PRIMARY KEY (message_id, user_id, emoji);
