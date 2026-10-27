#!/bin/bash
cd -- "$(dirname -- "$0")" || exit 1
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
node scripts/configure-gemini.js
echo 'После изменения ключа перезапустите Play Scout.'
read -r -p 'Нажмите Enter, чтобы закрыть окно. ' PLAY_SCOUT_REPLY
