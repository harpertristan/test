#!/bin/bash
set -e
cd -- "$(dirname -- "$0")"
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
if ! command -v node >/dev/null 2>&1 || ! node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 22 ? 0 : 1)'; then
  echo 'Установите Node.js LTS 22 или новее: https://nodejs.org/.'
  read -r -p 'Нажмите Enter, чтобы закрыть окно. ' PLAY_SCOUT_REPLY
  exit 1
fi
PLAY_SCOUT_LOCK=$(shasum -a 256 package-lock.json | awk '{print $1}')
PLAY_SCOUT_INSTALLED=$(cat .cache/install-lock 2>/dev/null || true)
if [ ! -d node_modules ] || [ "$PLAY_SCOUT_LOCK" != "$PLAY_SCOUT_INSTALLED" ]; then
  npm ci
  mkdir -p .cache
  printf '%s' "$PLAY_SCOUT_LOCK" > .cache/install-lock
fi
printf '\nОставьте это окно открытым. Браузер откроется после ответа программы.\nОстановка: Control+C или 5-Остановить.command.\n\n'
if [ "$(uname -s)" = Darwin ]; then
  exec caffeinate -i node scripts/start-desktop.js
else
  exec node scripts/start-desktop.js
fi
