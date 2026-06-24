#!/usr/bin/env bash
# Создаёт одноразовый invite-код и печатает ссылку для регистрации.
# Запуск из этого каталога при поднятом стеке:  ./invite.sh
# Опции (env):
#   INVITE_EXPIRES_DAYS  срок жизни в днях (по умолчанию 0 = бессрочно)
#   CLIENT_URL           база ссылки (по умолчанию http://localhost:5173)
set -euo pipefail
cd "$(dirname "$0")"

code=$(head -c 16 /dev/urandom | base64 | tr '+/' '-_' | tr -d '=')

days="${INVITE_EXPIRES_DAYS:-0}"
if [ "$days" -gt 0 ] 2>/dev/null; then
  expires="now() + interval '$days days'"
else
  expires="NULL"
fi

docker compose exec -T db psql -U alpha -d alpha -v ON_ERROR_STOP=1 -qtA -c \
  "INSERT INTO invites(code, expires_at) VALUES ('$code', $expires);" >/dev/null

base="${CLIENT_URL:-http://localhost:5173}"
echo "Invite link: ${base}/register?invite=${code}"
