#!/bin/bash
set -e
cd -- "$(dirname -- "$0")"
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
if ! command -v node >/dev/null 2>&1 || ! node -e 'if(Number(process.versions.node.split(".")[0])<22)process.exit(1)'; then
  echo 'Установите Node.js LTS версии 22 или новее с https://nodejs.org/.'
  read -r -p 'Нажмите Enter, чтобы закрыть окно. ' PLAY_SCOUT_REPLY
  exit 1
fi
if curl -fsS --max-time 2 http://127.0.0.1:3000/api/health >/dev/null 2>&1; then
  echo 'На порту 3000 уже работает программа. Для обновления кода или ключа остановите старое окно: Control+C.'
  if [ "$(uname -s)" = Darwin ]; then open 'http://localhost:3000/crm'; fi
  read -r -p 'Нажмите Enter, чтобы закрыть это окно. ' PLAY_SCOUT_REPLY
  exit 0
fi
PLAY_SCOUT_LOCK=$(shasum -a 256 package-lock.json | awk '{print $1}')
PLAY_SCOUT_INSTALLED=$(cat .cache/install-lock 2>/dev/null || true)
if [ ! -d node_modules ] || [ "$PLAY_SCOUT_LOCK" != "$PLAY_SCOUT_INSTALLED" ]; then
  npm ci
  mkdir -p .cache
  printf '%s' "$PLAY_SCOUT_LOCK" > .cache/install-lock
fi
printf '\nОставьте это окно открытым. Адрес программы: http://localhost:3000\nОстановка: Control+C. История и ключ сохраняются в папке программы.\n\n'
if [ "$(uname -s)" = Darwin ]; then
  (
    for PLAY_SCOUT_ATTEMPT in {1..40}; do
      if curl -fsS --max-time 1 http://127.0.0.1:3000/api/health >/dev/null 2>&1; then open 'http://localhost:3000/crm'; break; fi
      sleep 0.5
    done
  ) &
  exec caffeinate -i npm start
else
  exec npm start
fi
