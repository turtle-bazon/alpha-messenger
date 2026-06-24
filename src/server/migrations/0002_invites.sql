-- Регистрация только по инвайт-коду. Коды одноразовые.
-- created_by: NULL — код создан скриптом (bootstrap); позже сюда можно
-- проставлять автора-пользователя без введения системы ролей.
-- used_at IS NOT NULL — код погашен.

CREATE TABLE invites (
  code       text PRIMARY KEY,
  created_by uuid REFERENCES accounts(user_id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  used_by    uuid REFERENCES accounts(user_id) ON DELETE SET NULL,
  used_at    timestamptz
);
CREATE INDEX idx_invites_unused ON invites(code) WHERE used_at IS NULL;
