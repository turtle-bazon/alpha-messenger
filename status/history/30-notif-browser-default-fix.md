# 30. Дефолт браузерных уведомлений всегда включён (#30)

Исправлен ложный дефолт `alpha.notif.browser='0'` при первом входе. Раньше фикс #28 завязывал дефолт на `getPermission()`, и в окружениях без secure-context (где `Notification.permission` отдаёт `denied` из-за недоступности API, а не реальной блокировки) настройка ошибочно создавалась выключенной.

* `util/notifications.ts` → `initNotifDefaults()`: дефолт обоих ключей (`sound`, `browser`) теперь всегда `'1'`, без оглядки на permission.
* UI (`NotificationSettings.tsx`): тумблер показывает `browserChecked` — при `denied` «включён, но заблокирован» (как в Telegram), при `default` честно «выключен», пока разрешение не выдано.

Снято противоречие с прежней логикой #29 (принудительный `'0'` при denied). e2e `notif-defaults.spec.ts` обновлён; регресс notif-сценариев 6/6.
