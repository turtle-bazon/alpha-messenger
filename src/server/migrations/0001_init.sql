-- Первичная схема alpha messenger.
-- Идентификаторы сущностей — uuid. Порядковые величины (message_id, events.seq) —
-- глобальные IDENTITY-последовательности: монотонны, для каждого аккаунта дают
-- возрастающую подпоследовательность, без contention на per-account счётчике.

CREATE TABLE accounts (
  user_id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  username      text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE devices (
  device_id         uuid PRIMARY KEY,
  user_id           uuid NOT NULL REFERENCES accounts(user_id) ON DELETE CASCADE,
  device_public_key text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  last_seen_at      timestamptz
);
CREATE INDEX idx_devices_user ON devices(user_id);

-- Сессия (bearer-токен) привязана к паре (аккаунт, устройство).
CREATE TABLE sessions (
  token      text PRIMARY KEY,
  user_id    uuid NOT NULL REFERENCES accounts(user_id) ON DELETE CASCADE,
  device_id  uuid NOT NULL REFERENCES devices(device_id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_sessions_user ON sessions(user_id);

CREATE TABLE chats (
  chat_id    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type       text NOT NULL CHECK (type IN ('direct', 'group')),
  title      text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE chat_members (
  chat_id              uuid NOT NULL REFERENCES chats(chat_id) ON DELETE CASCADE,
  user_id              uuid NOT NULL REFERENCES accounts(user_id) ON DELETE CASCADE,
  joined_at            timestamptz NOT NULL DEFAULT now(),
  last_read_message_id bigint,
  PRIMARY KEY (chat_id, user_id)
);
CREATE INDEX idx_chat_members_user ON chat_members(user_id);

-- Сообщение. ciphertext — непрозрачный для сервера blob (в v1 шифрования нет,
-- но контракт исходит из того, что сервер текста не знает).
-- message_id монотонен и служит курсором порядка/пагинации истории.
CREATE TABLE messages (
  message_id        bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  chat_id           uuid NOT NULL REFERENCES chats(chat_id) ON DELETE CASCADE,
  sender_id         uuid NOT NULL REFERENCES accounts(user_id),
  client_message_id text NOT NULL,
  ciphertext        bytea NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  edited_at         timestamptz,
  deleted           boolean NOT NULL DEFAULT false,
  UNIQUE (chat_id, sender_id, client_message_id)
);
CREATE INDEX idx_messages_chat ON messages(chat_id, message_id DESC);

-- Outbox событий на доставку (fan-out на запись: по строке на получателя).
-- seq — глобальный сквозной курсор потока (Last-Event-ID / since).
-- payload хранит готовую к отправке полезную нагрузку события.
-- Таблица prunable: старые подтверждённые события можно будет вычищать.
CREATE TABLE events (
  seq        bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id    uuid NOT NULL REFERENCES accounts(user_id) ON DELETE CASCADE,
  type       text NOT NULL,
  chat_id    uuid REFERENCES chats(chat_id) ON DELETE CASCADE,
  payload    jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_events_user_seq ON events(user_id, seq);

CREATE TABLE push_subscriptions (
  subscription_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id       uuid NOT NULL REFERENCES devices(device_id) ON DELETE CASCADE,
  provider        text NOT NULL CHECK (provider IN ('fcm', 'unifiedpush')),
  endpoint        text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_push_device ON push_subscriptions(device_id);
