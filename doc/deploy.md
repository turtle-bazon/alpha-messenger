# Деплой за Apache-прокси

Контур `deploy` (run/deploy) тянет готовые образы из ghcr.io и работает за
обратным Apache-прокси: статику SPA отдаёт nginx клиента (:5173), REST (`/api/`)
и поток событий (`/ws`) проксируются на сервер (:3000). Конфиг прокси —
`run/deploy/apache-proxy.conf`.

## Обязательные модули Apache

`apache-proxy.conf` использует обратное проксирование и проксирование WebSocket.
Нужные модули в самом конфиге намеренно **не** включаются через `LoadModule` —
пути к `.so` зависят от дистрибутива, и жёсткая прописка ломала бы переносимость.
Включить их нужно на стороне установки Apache (один раз):

```apache
LoadModule proxy_module          modules/mod_proxy.so
LoadModule proxy_http_module     modules/mod_proxy_http.so
LoadModule proxy_wstunnel_module modules/mod_proxy_wstunnel.so
LoadModule headers_module        modules/mod_headers.so
```

- `mod_proxy` + `mod_proxy_http` — проксирование `/api/` и статики SPA.
- `mod_proxy_wstunnel` — апгрейд WebSocket для `/ws` (поток событий).
- `mod_headers` — `RequestHeader set X-Forwarded-Proto` в виртуалхосте.

Способ включения зависит от дистрибутива:

- Debian/Ubuntu: `a2enmod proxy proxy_http proxy_wstunnel headers && systemctl reload apache2`.
- RHEL/Fedora/Arch: модули обычно собраны как `.so`; добавить строки `LoadModule`
  выше в основной `httpd.conf` (или в файл внутри `conf.modules.d/`) и перезапустить
  `httpd`. Точные пути к модулям сверять с раскладкой пакета.

## Адрес сервера (плейсхолдер)

В `apache-proxy.conf` бэкенд указан как плейсхолдер `<app-host>`:

```apache
ProxyPass /ws  ws://<app-host>:3000/ws
ProxyPass /api/ http://<app-host>:3000/api/
```

При деплое подставить реальный адрес сервера (хост/IP, где поднят контейнер
сервера) вместо `<app-host>`. Если Apache и сервер на одной машине — `127.0.0.1`.
`ServerName` в виртуалхосте тоже заменить на свой домен.
