-- Стикеры: паки и отдельные стикеры.
-- Стикеры хранятся как blob_id (sha256), загружаются через /api/blobs.

CREATE TABLE sticker_packs (
  pack_id    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES accounts(user_id),
  title      text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_sticker_packs_user ON sticker_packs(user_id);

-- Отношение "пользователь установил пак": для быстрого списка "мои паки".
CREATE TABLE user_sticker_packs (
  user_id uuid NOT NULL REFERENCES accounts(user_id) ON DELETE CASCADE,
  pack_id uuid NOT NULL REFERENCES sticker_packs(pack_id) ON DELETE CASCADE,
  added_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, pack_id)
);

CREATE TABLE sticker_items (
  item_id   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pack_id   uuid NOT NULL REFERENCES sticker_packs(pack_id) ON DELETE CASCADE,
  blob_id   text NOT NULL REFERENCES blobs(blob_id),
  position  int NOT NULL DEFAULT 0,
  emoji     text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_sticker_items_pack ON sticker_items(pack_id, position);
