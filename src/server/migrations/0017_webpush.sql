-- Web Push (RFC 8030 + VAPID) for the browser / installed PWA (iOS Safari home
-- screen app, desktop and Android browsers). The endpoint column holds the whole
-- PushSubscription JSON ({endpoint, keys: {p256dh, auth}}) — the server needs the
-- keys to encrypt the payload.
ALTER TABLE push_subscriptions DROP CONSTRAINT push_subscriptions_provider_check;
ALTER TABLE push_subscriptions ADD CONSTRAINT push_subscriptions_provider_check
  CHECK (provider IN ('fcm', 'unifiedpush', 'webpush'));

-- Result of the last delivery attempt as answered by the push service: lets the
-- "test notifications" button and logs tell "accepted" from "rejected".
ALTER TABLE push_subscriptions ADD COLUMN last_status_code int;
ALTER TABLE push_subscriptions ADD COLUMN last_status_at timestamptz;

-- Server-generated secrets that must survive restarts (VAPID key pair when it
-- is not given through the environment).
CREATE TABLE server_secrets (
  name       text PRIMARY KEY,
  value      text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
