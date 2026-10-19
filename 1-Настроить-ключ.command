#!/bin/bash
set -e
cd -- "$(dirname -- "$0")"
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
if ! command -v node >/dev/null 2>&1; then
  echo 'Сначала установите Node.js LTS с https://nodejs.org/ и откройте этот файл снова.'
  read -r -p 'Нажмите Enter, чтобы закрыть окно. ' PLAY_SCOUT_REPLY
  exit 1
fi
node scripts/configure-brave.js
printf '\nЕсли программа уже запущена, остановите её в старом окне (Control+C), затем откройте 2-Запустить.command.\n'
read -r -p 'Нажмите Enter, чтобы закрыть окно. ' PLAY_SCOUT_REPLY
