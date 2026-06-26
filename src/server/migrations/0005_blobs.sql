-- Хранилище крупных вложений: сервер держит непрозрачные (в будущем —
-- зашифрованные клиентом) блобы, адресуемые по sha256-хэшу содержимого.
-- Содержимое и ключ расшифровки серверу неизвестны; здесь только метаданные
-- для авторизации доступа и будущей сборки мусора.
CREATE TABLE blobs (
  blob_id    text PRIMARY KEY,                                   -- sha256 hex содержимого
  size       bigint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Кто загружал блоб. Из-за content-addressed дедупликации один и тот же блоб
-- (одинаковые байты) могут загрузить несколько пользователей — фиксируем всех.
-- Даёт право скачивания самому загрузчику ещё до привязки блоба к сообщению.
CREATE TABLE blob_owners (
  blob_id    text NOT NULL REFERENCES blobs(blob_id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES accounts(user_id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (blob_id, user_id)
);

-- Связь сообщение↔блоб. Сервер не может прочитать ссылку из ciphertext (она
-- зашифрована), поэтому список blobIds приходит открытым при отправке
-- сообщения и материализуется здесь — для проверки доступа (членство в чате
-- сообщения) и подсчёта ссылок при будущей очистке.
-- ON DELETE CASCADE: при будущем жёстком удалении сообщения связь уходит сама;
-- soft-delete (deleted=true) строку оставляет, но доступ снимается в запросе.
CREATE TABLE message_blobs (
  message_id bigint NOT NULL REFERENCES messages(message_id) ON DELETE CASCADE,
  blob_id    text   NOT NULL REFERENCES blobs(blob_id),
  PRIMARY KEY (message_id, blob_id)
);
CREATE INDEX idx_message_blobs_blob ON message_blobs(blob_id);
