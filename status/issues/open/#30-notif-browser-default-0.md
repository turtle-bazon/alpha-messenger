# #30 — alpha.notif.browser создаётся как "0" вместо "1"

[Баг] `initNotifDefaults()` при первом входе создаёт `alpha.notif.browser:"0"` вместо `"1"`. Причина: `getPermission()` возвращает `'denied'` (браузер не поддерживает Notification API или нет secure context), и `initNotifDefaults()` записывает `'0'`. Но `notificationsSupported()` тоже может вернуть `false` → `getPermission()` → `'denied'` → `setNotifBrowser(false)`.

Нужно: при первом входе (ключей нет) дефолт ВСЕГДА `'1'` для browser, независимо от текущего `Notification.permission`. Если позже выяснится что разрешение denied — `ensureBrowserPermission()` это обработает. Но дефолтное значение в localStorage должно быть `'1'` (включено), чтобы пользователь видел что настройка активна и мог её отключить вручную.

Клоду: исправить `initNotifDefaults()` — убрать проверку `getPermission() === 'denied'` при создании дефолта. Писать `'1'` всегда когда ключа нет. `ensureBrowserPermission()` при `denied` просто ничего не делает (не спрашивает), а UI показывает тумблер включённым но заблокированным (как в Telegram).
