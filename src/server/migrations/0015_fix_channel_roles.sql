-- Fix: channel members added without explicit role get 'subscriber'.
UPDATE chat_members SET role = 'subscriber'
WHERE role = 'member'
  AND chat_id IN (SELECT chat_id FROM chats WHERE username IS NOT NULL);
