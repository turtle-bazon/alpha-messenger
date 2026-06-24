-- Идемпотентность перерегистрации канала пуша: приложение переотправляет
-- FCM-токен / UnifiedPush-endpoint при каждом запуске. Один и тот же endpoint
-- на устройстве не должен плодить дубликаты подписок.
ALTER TABLE push_subscriptions
  ADD CONSTRAINT push_subscriptions_device_endpoint_uniq UNIQUE (device_id, endpoint);
