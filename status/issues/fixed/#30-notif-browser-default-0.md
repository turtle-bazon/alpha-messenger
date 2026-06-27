# #30 — alpha.notif.browser создаётся как "0" вместо "1"

[Баг] `initNotifDefaults()` при первом входе создаёт `alpha.notif.browser:"0"` вместо `"1"`. Причина: `getPermission()` возвращает `'denied'` (браузер не поддерживает Notification API или нет secure context), и `initNotifDefaults()` записывает `'0'`. Но `notificationsSupported()` тоже может вернуть `false` → `getPermission()` → `'denied'` → `setNotifBrowser(false)`.

Нужно: при первом входе (ключей нет) дефолт ВСЕГДА `'1'` для browser, независимо от текущего `Notification.permission`. Если позже выяснится что разрешение denied — `ensureBrowserPermission()` это обработает. Но дефолтное значение в localStorage должно быть `'1'` (включено), чтобы пользователь видел что настройка активна и мог её отключить вручную.

Клоду: исправить `initNotifDefaults()` — убрать проверку `getPermission() === 'denied'` при создании дефолта. Писать `'1'` всегда когда ключа нет. `ensureBrowserPermission()` при `denied` просто ничего не делает (не спрашивает), а UI показывает тумблер включённым но заблокированным (как в Telegram).

## Решено

* `util/notifications.ts` → `initNotifDefaults()`: убрана завязка на `getPermission()`. Теперь при первом входе (ключа нет) обоим — `sound` и `browser` — явно сидится `'1'`, независимо от текущего `Notification.permission`. Это убирает ложный `'0'` в окружениях, где `permission='denied'` означает лишь недоступность API (нет secure-context), а не реальную блокировку.
* `ensureBrowserPermission()` при `denied` и так ничего не делает (выходит на `permission !== 'default'`) — поведение сохранено.
* UI (`NotificationSettings.tsx`): тумблер браузерных уведомлений теперь показывает `browserChecked`. В норме это реальное состояние (`browserActive` = настройка И `granted`), поэтому при `default` тумблер честно «выключен». Исключение — `denied`: тумблер недоступен (`disabled`) и показывает сохранённую настройку (по умолчанию включена) — «включён, но заблокирован», как в Telegram, без рассинхрона с localStorage. Подсказка о блокировке сохранена.

Это снимает противоречие из #29 (там при `denied` принудительно сидился `'0'`): значение в хранилище больше не зависит от того, поддержан ли API в текущем окружении.

e2e `e2e/notif-defaults.spec.ts` обновлён: при `denied` теперь ожидается `browser='1'`, тумблер `checked`+`disabled`+подсказка. Случай `default` (`notifications.spec.ts`: тумблер «выключен», пока разрешение не выдано) не затронут. Регресс notif-сценариев 6/6.
